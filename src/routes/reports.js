import { Router } from 'express'
import { prisma } from '../config/prisma.js'
import { requirePermission } from '../middleware/auth.js'
import { HttpError } from '../middleware/errors.js'
import { PROFILES } from '../permissions/catalog.js'
import { findSheet } from './sheets.js'

/**
 * Signalements hiérarchiques depuis une feuille de saisie (/api/reports).
 * Un agent APS signale d'abord à son chef de poste ; le chef de poste peut ensuite transmettre au responsable sécurité.
 * Le destinataire reçoit une notification (voir notifications.js).
 */
export const reportsRouter = Router()

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_MESSAGE = 2000

/** Échelle hiérarchique : profil de l'auteur → profil de son supérieur (5 Agent APS → 2 Chef de poste → 3 Responsable sécurité). */
export const ESCALATION = { 5: 2, 2: 3 }
/** Un administrateur signale « pour le compte de » n'importe quel niveau de l'échelle. */
const ADMIN_TARGETS = [2, 3]

const canReport = requirePermission(['sheets'], { action: 'report' })

/** Niveaux (profils) auxquels cet utilisateur peut adresser un signalement. */
const targetsFor = (access) => (access.profile === 1 ? ADMIN_TARGETS : ESCALATION[access.profile] ? [ESCALATION[access.profile]] : [])

const cleanMessage = (value, { required }) => {
  const message = typeof value === 'string' ? value.trim() : ''
  if (required && !message) throw new HttpError(400, 'Décrivez le problème à signaler.')
  if (message.length > MAX_MESSAGE) throw new HttpError(400, `Le message est trop long (${MAX_MESSAGE} caractères maximum).`)
  return message
}

/** Destinataires d'un niveau : les comptes de ce profil affectés au poste, sinon tous ceux du site. */
async function findRecipients(sheet, toProfile, excludeUserId) {
  const where = { active: true, siteId: sheet.post.siteId, profile: toProfile, NOT: { id: excludeUserId } }
  const select = { id: true, name: true }
  const assigned = await prisma.user.findMany({ where: { ...where, postAssignments: { some: { postId: sheet.post.id } } }, select })
  return assigned.length > 0 ? assigned : prisma.user.findMany({ where, select })
}

/** Crée le signalement et notifie les destinataires. */
async function deliver({ sheet, rowId, reporter, toProfile, message, title, body, parentId }) {
  const recipients = await findRecipients(sheet, toProfile, reporter.id)
  if (recipients.length === 0) throw new HttpError(409, `Aucun compte « ${PROFILES[toProfile]} » actif sur ce site pour recevoir le signalement.`)
  const report = await prisma.sheetReport.create({
    data: {
      sheetId: sheet.id,
      rowId,
      postId: sheet.post.id,
      siteId: sheet.post.siteId,
      reporterId: reporter.id,
      fromProfile: reporter.profile,
      toProfile,
      message,
      parentId,
      notifications: { create: recipients.map((user) => ({ userId: user.id, title, body })) },
    },
    select: { id: true },
  })
  return { report, recipients: recipients.map((user) => user.name) }
}

/** À qui l'utilisateur peut-il adresser un signalement ? (vide : pas de bouton « Signaler au supérieur ») */
reportsRouter.get('/targets', (req, res) => {
  const targets = req.access.permissions.has('sheets.report') ? targetsFor(req.access) : []
  res.json({ targets: targets.map((profile) => ({ profile, label: PROFILES[profile] })) })
})

/** Signale un problème dans une feuille, éventuellement à propos d'une ligne. */
reportsRouter.post('/', canReport, async (req, res) => {
  const { sheetId, rowId } = req.body ?? {}
  const message = cleanMessage(req.body?.message, { required: true })
  const sheet = await findSheet(req.access, sheetId, 'use')
  if (rowId !== undefined && rowId !== null) {
    if (typeof rowId !== 'string' || !UUID.test(rowId) || !(await prisma.sheetRow.findFirst({ where: { id: rowId, sheetId: sheet.id }, select: { id: true } }))) {
      throw new HttpError(404, 'Ligne introuvable.')
    }
  }
  const allowed = targetsFor(req.access)
  const toProfile = req.access.profile === 1 ? Number(req.body?.toProfile ?? ADMIN_TARGETS[0]) : allowed[0]
  if (!allowed.includes(toProfile)) throw new HttpError(403, "Vous n'avez pas de supérieur à qui adresser un signalement.")

  const { report, recipients } = await deliver({
    sheet,
    rowId: rowId ?? null,
    reporter: req.access,
    toProfile,
    message,
    title: `${req.access.name} signale un problème`,
    body: `Poste « ${sheet.post.name} » — feuille « ${sheet.name} »\n${message}`,
    parentId: null,
  })
  res.status(201).json({ report, recipients })
})

/** Transmet un signalement reçu au niveau supérieur (ex. le chef de poste au responsable sécurité). */
reportsRouter.post('/:id/escalate', canReport, async (req, res) => {
  const { access } = req
  const id = req.params.id
  const original = UUID.test(id)
    ? await prisma.sheetReport.findUnique({
        where: { id },
        include: { reporter: { select: { name: true } }, sheet: { include: { post: { select: { id: true, name: true, siteId: true } } } } },
      })
    : null
  if (!original) throw new HttpError(404, 'Signalement introuvable.')
  // Seul un destinataire du signalement peut le transmettre.
  const received = await prisma.notification.findFirst({ where: { reportId: id, userId: access.id, type: 'REPORT' }, select: { id: true } })
  if (!received) throw new HttpError(403, "Ce signalement ne vous est pas adressé.")
  if (original.resolvedAt) throw new HttpError(409, 'Ce signalement est déjà traité.')
  const toProfile = ESCALATION[access.profile]
  if (!toProfile) throw new HttpError(403, "Vous n'avez pas de supérieur à qui transmettre ce signalement.")
  if (await prisma.sheetReport.findFirst({ where: { parentId: id, reporterId: access.id }, select: { id: true } })) {
    throw new HttpError(409, 'Vous avez déjà transmis ce signalement.')
  }
  const comment = cleanMessage(req.body?.message, { required: false })

  const { report, recipients } = await deliver({
    sheet: original.sheet,
    rowId: original.rowId,
    reporter: access,
    toProfile,
    message: comment || original.message,
    title: `${access.name} vous transmet un signalement`,
    body:
      `Signalé par ${original.reporter.name} (${PROFILES[original.fromProfile]}) — poste « ${original.sheet.post.name} », feuille « ${original.sheet.name} »\n${original.message}` +
      (comment ? `\nComplément de ${access.name} : ${comment}` : ''),
    parentId: original.id,
  })
  await prisma.notification.updateMany({ where: { reportId: id, userId: access.id, readAt: null }, data: { readAt: new Date() } })
  res.status(201).json({ report, recipients })
})

// ------------------------------------------------------------------ Détail, fichiers et traitement

/** Un signalement n'est accessible qu'à son auteur, à ses destinataires et à un administrateur (même s'ils ne sont pas affectés au poste). */
async function loadReport(access, id) {
  const report = UUID.test(id)
    ? await prisma.sheetReport.findUnique({
        where: { id },
        include: {
          reporter: { select: { name: true } },
          resolver: { select: { name: true } },
          sheet: { include: { columns: { orderBy: { position: 'asc' } }, post: { select: { id: true, name: true, siteId: true } } } },
          row: { include: { author: { select: { name: true } } } },
        },
      })
    : null
  if (!report) throw new HttpError(404, 'Signalement introuvable.')
  const isRecipient = await prisma.notification.findFirst({ where: { reportId: id, userId: access.id, type: 'REPORT' }, select: { id: true } })
  if (access.profile !== 1 && report.reporterId !== access.id && !isRecipient) throw new HttpError(403, 'Ce signalement ne vous concerne pas.')
  return { report, isRecipient: Boolean(isRecipient) }
}

/** Tous les signalements de la même chaîne (l'original et ses transmissions), du plus ancien au plus récent. */
async function threadOf(report) {
  let root = report
  for (let depth = 0; root.parentId && depth < 6; depth += 1) {
    root = await prisma.sheetReport.findUnique({ where: { id: root.parentId }, select: { id: true, parentId: true } })
  }
  const ids = [root.id]
  for (let frontier = [root.id], depth = 0; frontier.length > 0 && depth < 6; depth += 1) {
    const children = await prisma.sheetReport.findMany({ where: { parentId: { in: frontier } }, select: { id: true } })
    frontier = children.map((child) => child.id)
    ids.push(...frontier)
  }
  const thread = await prisma.sheetReport.findMany({ where: { id: { in: ids } }, orderBy: { createdAt: 'asc' }, include: { reporter: { select: { name: true } } } })
  return thread.map((entry) => ({
    id: entry.id,
    reporter: entry.reporter.name,
    fromLabel: PROFILES[entry.fromProfile],
    toLabel: PROFILES[entry.toProfile],
    message: entry.message,
    createdAt: entry.createdAt,
    resolved: entry.resolvedAt !== null,
    current: entry.id === report.id,
  }))
}

/** Détail d'un signalement : message, ligne concernée (valeurs et fichiers), chaîne de transmission. */
reportsRouter.get('/:id', async (req, res) => {
  const { report, isRecipient } = await loadReport(req.access, req.params.id)
  const { sheet, row } = report

  let rowDetail = null
  if (row) {
    const attach = sheet.columns.filter((column) => column.type === 'ACTION' && column.action === 'ATTACH_FILES')
    const files = attach.length > 0 ? await prisma.sheetFile.findMany({ where: { rowId: row.id, columnId: { in: attach.map((column) => column.id) } }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true, size: true, columnId: true } }) : []
    rowDetail = {
      id: row.id,
      createdAt: row.createdAt,
      author: row.author?.name ?? null,
      fields: sheet.columns.filter((column) => column.type !== 'ACTION').map((column) => ({ label: column.label, type: column.type, value: row.values[column.id] ?? '' })),
      fileGroups: attach.map((column) => ({ label: column.label, files: files.filter((file) => file.columnId === column.id).map(({ id, name, size }) => ({ id, name, size })) })),
    }
  }

  const next = ESCALATION[req.access.profile]
  res.json({
    report: {
      id: report.id,
      message: report.message,
      createdAt: report.createdAt,
      reporter: report.reporter.name,
      fromLabel: PROFILES[report.fromProfile],
      toLabel: PROFILES[report.toProfile],
      resolved: report.resolvedAt !== null,
      resolvedAt: report.resolvedAt,
      resolvedBy: report.resolver?.name ?? null,
      sheet: { id: sheet.id, name: sheet.name, postName: sheet.post.name },
      siteId: sheet.post.siteId,
      rowId: row?.id ?? null,
    },
    row: rowDetail,
    thread: await threadOf(report),
    canResolve: report.resolvedAt === null && (isRecipient || req.access.profile === 1),
    canEscalate: report.resolvedAt === null && isRecipient && req.access.permissions.has('sheets.report') && req.access.profile !== 1 && next !== undefined && report.toProfile === req.access.profile,
  })
})

/** Contenu d'un fichier joint à la ligne signalée (pour que le destinataire voie les preuves, même sans être affecté au poste). */
reportsRouter.get('/:id/files/:fileId', async (req, res) => {
  const { report } = await loadReport(req.access, req.params.id)
  const file = report.rowId && UUID.test(req.params.fileId) ? await prisma.sheetFile.findFirst({ where: { id: req.params.fileId, rowId: report.rowId } }) : null
  if (!file) throw new HttpError(404, 'Fichier introuvable.')
  res
    .set({
      'Content-Type': file.mimeType,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name).replaceAll("'", '%27')}`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    .send(Buffer.from(file.content))
})

/**
 * Marque un signalement comme traité (par un destinataire ou un administrateur).
 * Le problème étant réglé, les signalements précédents de la chaîne sont traités aussi, et leurs auteurs sont prévenus.
 */
reportsRouter.post('/:id/resolve', async (req, res) => {
  const { access } = req
  const { report, isRecipient } = await loadReport(access, req.params.id)
  if (!isRecipient && access.profile !== 1) throw new HttpError(403, 'Seul le destinataire du signalement peut le marquer comme traité.')
  if (report.resolvedAt) throw new HttpError(409, 'Ce signalement est déjà traité.')

  // Ce signalement et ceux dont il est la transmission.
  const chain = [report]
  for (let current = report, depth = 0; current.parentId && depth < 6; depth += 1) {
    current = await prisma.sheetReport.findUnique({ where: { id: current.parentId }, include: { reporter: { select: { name: true } } } })
    if (!current) break
    if (!current.resolvedAt) chain.push(current)
  }
  const now = new Date()
  const ids = chain.map((entry) => entry.id)
  const context = `Poste « ${report.sheet.post.name} » — feuille « ${report.sheet.name} »`
  await prisma.$transaction([
    prisma.sheetReport.updateMany({ where: { id: { in: ids } }, data: { resolvedAt: now, resolvedById: access.id } }),
    // Les auteurs (hors celui qui traite) apprennent que le problème est traité.
    prisma.notification.createMany({
      data: chain
        .filter((entry) => entry.reporterId !== access.id)
        .map((entry) => ({ userId: entry.reporterId, type: 'REPORT_RESOLVED', title: `${access.name} a traité votre signalement`, body: `${context}\n${entry.message}`, reportId: entry.id })),
    }),
    // Les notifications de signalement de celui qui traite sont lues.
    prisma.notification.updateMany({ where: { reportId: { in: ids }, userId: access.id, readAt: null }, data: { readAt: now } }),
  ])
  res.json({ resolved: ids.length })
})

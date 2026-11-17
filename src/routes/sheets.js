import express, { Router } from 'express'
import { ALLOWED_FILE_TYPES, MAX_FILE_BYTES, readFileName } from '../config/files.js'
import { prisma } from '../config/prisma.js'
import { requirePermission } from '../middleware/auth.js'
import { HttpError } from '../middleware/errors.js'

/**
 * Feuilles de saisie d'un poste (/api/sheets) : l'équivalent d'un classeur Excel par poste.
 * - La STRUCTURE (feuilles, colonnes) se règle avec `administration.update` ;
 * - les LIGNES se consultent et se saisissent avec `sheets.*`.
 * Chaque feuille limite en plus les droits de saisie (`allowCreate`, `allowUpdate`, `allowDelete`) : une action n'est permise que si le rôle ET la feuille l'autorisent.
 * Les feuilles d'un poste sont RÉSERVÉES aux utilisateurs affectés à ce poste : eux seuls voient la liste des feuilles, leurs lignes et leurs fichiers.
 * Un ADMINISTRATEUR (profil 1) fait exception : il accède à toutes les feuilles et à tous les droits de saisie, quels que soient les réglages de la feuille.
 * Un compte qui règle la structure (`administration.update`) peut en plus ouvrir le constructeur d'une feuille, sans accéder aux lignes saisies.
 */
export const sheetsRouter = Router()

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COLUMN_TYPES = ['TEXT', 'NUMBER', 'DATE', 'TIME', 'SELECT', 'CHECKBOX', 'ACTION']
const COLUMN_ACTIONS = ['ATTACH_FILES']
const MAX_FILES_PER_CELL = 20
const MAX_COLUMNS = 60
const MAX_ROWS = 1000

const design = requirePermission(['administration'], { action: 'update' })
const sheetsGate = requirePermission(['sheets'])

const columnDto = (column) => ({ id: column.id, label: column.label, type: column.type, required: column.required, options: column.options, action: column.action, allowUpload: column.allowUpload, allowPhoto: column.allowPhoto, position: column.position })

const sheetInclude = { columns: { orderBy: { position: 'asc' } }, post: { select: { id: true, name: true, siteId: true, assignees: { select: { userId: true, user: { select: { name: true, active: true } } } } } } }

const sheetDto = (sheet) => ({
  id: sheet.id,
  postId: sheet.postId,
  postName: sheet.post.name,
  siteId: sheet.post.siteId,
  /** Utilisateurs affectés au poste : seuls à pouvoir voir et remplir les feuilles. */
  postUsers: sheet.post.assignees
    .filter((assignment) => assignment.user.active)
    .map((assignment) => ({ id: assignment.userId, name: assignment.user.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr')),
  name: sheet.name,
  position: sheet.position,
  allowCreate: sheet.allowCreate,
  allowUpdate: sheet.allowUpdate,
  allowDelete: sheet.allowDelete,
  columns: sheet.columns.map(columnDto),
})

function assertSiteScope(access, siteId) {
  if (access.profile !== 1 && siteId !== access.siteId) throw new HttpError(403, 'Vous ne pouvez accéder qu\'aux feuilles de votre site.')
}

/** Un administrateur (profil 1) a accès à toutes les feuilles ; les autres comptes seulement à celles des postes auxquels ils sont affectés. */
const isAssignee = (access, sheet) => access.profile === 1 || sheet.post.assignees.some((assignment) => assignment.userId === access.id)

/** Accès à la STRUCTURE d'une feuille : l'utilisateur affecté au poste, ou un compte qui règle les feuilles. */
const canSeeStructure = (access, sheet) => isAssignee(access, sheet) || access.permissions.has('administration.update')

/**
 * Charge une feuille active du site de l'utilisateur.
 * `mode: 'use'` (par défaut) : lignes, fichiers, saisie → réservé à l'utilisateur affecté au poste.
 * `mode: 'structure'` : colonnes et réglages → l'utilisateur affecté, ou `administration.update`.
 */
export async function findSheet(access, id, mode = 'use') {
  const sheet = UUID.test(id) ? await prisma.postSheet.findFirst({ where: { id, active: true }, include: sheetInclude }) : null
  if (!sheet) throw new HttpError(404, 'Feuille introuvable.')
  assertSiteScope(access, sheet.post.siteId)
  const allowed = mode === 'structure' ? canSeeStructure(access, sheet) : isAssignee(access, sheet)
  if (!allowed) throw new HttpError(403, 'Les feuilles de saisie sont réservées aux utilisateurs affectés au poste.')
  return sheet
}

/** Une action de saisie exige que la feuille l'autorise (en plus de la permission du rôle, vérifiée par `requirePermission`). */
function assertSheetAllows(access, sheet, action) {
  // Un administrateur a tous les droits sur les lignes, quels que soient les réglages de la feuille.
  if (access.profile === 1) return
  const allowed = { create: sheet.allowCreate, update: sheet.allowUpdate, delete: sheet.allowDelete }[action]
  if (!allowed) {
    const what = { create: "d'ajouter des lignes", update: 'de modifier les lignes', delete: 'de supprimer des lignes' }[action]
    throw new HttpError(403, `Cette feuille ne permet pas ${what}.`)
  }
}

const cleanText = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '')

const duplicateName = (error) => {
  if (error.code === 'P2002') throw new HttpError(409, 'Une feuille porte déjà ce nom sur ce poste.')
  throw error
}

/** Refuse un nom déjà pris (sans tenir compte de la casse) par une autre feuille du même poste. */
async function ensureUniqueName(postId, name, exceptId) {
  const taken = await prisma.postSheet.findFirst({ where: { postId, name: { equals: name, mode: 'insensitive' }, ...(exceptId && { NOT: { id: exceptId } }) }, select: { id: true } })
  if (taken) throw new HttpError(409, 'Une feuille porte déjà ce nom sur ce poste.')
}

/** Valide la définition des colonnes envoyée par le constructeur. */
function parseColumns(input) {
  if (!Array.isArray(input) || input.length > MAX_COLUMNS) throw new HttpError(400, `Une feuille compte ${MAX_COLUMNS} colonnes au maximum.`)
  const labels = new Set()
  return input.map((raw, index) => {
    const label = cleanText(raw?.label, 120)
    if (!label) throw new HttpError(400, `Donnez un nom à la colonne ${index + 1}.`)
    if (labels.has(label.toLowerCase())) throw new HttpError(400, `Deux colonnes portent le nom « ${label} ».`)
    labels.add(label.toLowerCase())
    const type = raw?.type
    if (!COLUMN_TYPES.includes(type)) throw new HttpError(400, `Le type de la colonne « ${label} » est invalide.`)
    let options = []
    if (type === 'SELECT') {
      options = [...new Set((Array.isArray(raw.options) ? raw.options : []).map((option) => cleanText(option, 120)).filter(Boolean))]
      if (options.length === 0) throw new HttpError(400, `Indiquez au moins un choix pour la colonne « ${label} ».`)
    }
    // Une colonne « Action » ne reçoit pas de valeur : elle déclenche une action sur la ligne (ex. attacher des fichiers).
    let action = null
    let allowUpload = true
    let allowPhoto = false
    if (type === 'ACTION') {
      action = raw.action
      if (!COLUMN_ACTIONS.includes(action)) throw new HttpError(400, `Choisissez l'action de la colonne « ${label} ».`)
      // Attacher des fichiers : depuis l'appareil, avec la caméra, ou les deux.
      allowUpload = raw.allowUpload !== false
      allowPhoto = raw.allowPhoto === true
      if (!allowUpload && !allowPhoto) throw new HttpError(400, `Autorisez l'envoi de fichiers ou la prise de photo pour la colonne « ${label} ».`)
    }
    const id = typeof raw.id === 'string' && UUID.test(raw.id) ? raw.id : undefined
    return { id, label, type, action, allowUpload, allowPhoto, required: type !== 'ACTION' && raw.required === true, options, position: index }
  })
}

// ------------------------------------------------------------------------------------------- Structure

/** Feuilles d'un poste (`postId`) ou de tous les postes d'un site (`siteId`). */
sheetsRouter.get('/', sheetsGate, async (req, res) => {
  const postId = typeof req.query.postId === 'string' ? req.query.postId : ''
  const siteId = typeof req.query.siteId === 'string' ? req.query.siteId : ''
  if (!UUID.test(postId) && !UUID.test(siteId)) throw new HttpError(400, 'Indiquez le poste ou le site.')
  // Par site : les feuilles des postes auxquels l'utilisateur est affecté (toutes pour un administrateur).
  const where = UUID.test(postId) ? { postId, post: { active: true } } : { post: { siteId, active: true, ...(req.access.profile === 1 ? {} : { assignees: { some: { userId: req.access.id } } }) } }
  if (UUID.test(siteId) && !UUID.test(postId)) assertSiteScope(req.access, siteId)
  const sheets = await prisma.postSheet.findMany({
    where: { active: true, ...where },
    orderBy: [{ post: { name: 'asc' } }, { position: 'asc' }, { createdAt: 'asc' }],
    include: sheetInclude,
  })
  for (const sheet of sheets) assertSiteScope(req.access, sheet.post.siteId)
  // Par poste : on ne montre que ce que l'utilisateur a le droit d'ouvrir (feuilles de son poste, ou structure pour qui règle les feuilles).
  res.json({ sheets: sheets.filter((sheet) => canSeeStructure(req.access, sheet)).map(sheetDto) })
})

sheetsRouter.get('/:id', sheetsGate, async (req, res) => {
  res.json({ sheet: sheetDto(await findSheet(req.access, req.params.id, 'structure')) })
})

sheetsRouter.post('/', design, async (req, res) => {
  const name = cleanText(req.body?.name, 160)
  const postId = req.body?.postId
  if (!name || !UUID.test(postId ?? '')) throw new HttpError(400, 'Indiquez le poste et le nom de la feuille.')
  const post = await prisma.post.findFirst({ where: { id: postId, active: true }, select: { siteId: true } })
  if (!post) throw new HttpError(404, 'Poste introuvable ou désactivé.')
  assertSiteScope(req.access, post.siteId)
  await ensureUniqueName(postId, name)
  const last = await prisma.postSheet.aggregate({ where: { postId }, _max: { position: true } })
  const sheet = await prisma.postSheet
    .create({ data: { postId, name, position: (last._max.position ?? -1) + 1 }, include: sheetInclude })
    .catch(duplicateName)
  res.status(201).json({ sheet: sheetDto(sheet) })
})

/** Remplace le nom et la liste des colonnes. Une colonne absente de la liste est retirée (ses valeurs sont conservées dans les lignes mais plus affichées). */
sheetsRouter.put('/:id', design, async (req, res) => {
  const current = await findSheet(req.access, req.params.id, 'structure')
  const name = cleanText(req.body?.name, 160)
  if (!name) throw new HttpError(400, 'Indiquez le nom de la feuille.')
  const columns = parseColumns(req.body?.columns)
  await ensureUniqueName(current.postId, name, current.id)
  const existingIds = new Set(current.columns.map((column) => column.id))
  const keptIds = columns.filter((column) => column.id && existingIds.has(column.id)).map((column) => column.id)

  await prisma
    .$transaction([
      prisma.postSheet.update({
        where: { id: current.id },
        data: {
          name,
          // Droits de la feuille : une valeur absente laisse le réglage actuel.
          ...Object.fromEntries(['allowCreate', 'allowUpdate', 'allowDelete'].filter((key) => typeof req.body?.[key] === 'boolean').map((key) => [key, req.body[key]])),
        },
      }),
      prisma.sheetColumn.deleteMany({ where: { sheetId: current.id, id: { notIn: keptIds } } }),
      ...columns.map((column) =>
        column.id && existingIds.has(column.id)
          ? prisma.sheetColumn.update({ where: { id: column.id }, data: { label: column.label, type: column.type, action: column.action, allowUpload: column.allowUpload, allowPhoto: column.allowPhoto, required: column.required, options: column.options, position: column.position } })
          : prisma.sheetColumn.create({ data: { sheetId: current.id, label: column.label, type: column.type, action: column.action, allowUpload: column.allowUpload, allowPhoto: column.allowPhoto, required: column.required, options: column.options, position: column.position } }),
      ),
    ])
    .catch(duplicateName)
  res.json({ sheet: sheetDto(await findSheet(req.access, current.id, 'structure')) })
})

/** Archive la feuille : ses lignes saisies sont conservées. */
sheetsRouter.delete('/:id', design, async (req, res) => {
  const current = await findSheet(req.access, req.params.id, 'structure')
  await prisma.postSheet.update({ where: { id: current.id }, data: { active: false, name: `${current.name} (archivée ${new Date().toISOString().slice(0, 10)} ${current.id.slice(0, 4)})`.slice(0, 160) } })
  res.json({ id: current.id, archived: true })
})

// ----------------------------------------------------------------------------------------------- Lignes

const rowDto = (row, fileCounts = {}) => ({ id: row.id, values: row.values, createdAt: row.createdAt, author: row.author?.name ?? null, fileCounts })
const rowInclude = { author: { select: { name: true } } }

/** Contrôle et normalise les valeurs saisies d'après les colonnes de la feuille. */
function parseValues(sheet, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Les valeurs saisies sont invalides.')
  const values = {}
  for (const column of sheet.columns) {
    if (column.type === 'ACTION') continue
    const raw = input[column.id]
    const text = typeof raw === 'string' ? raw.trim() : typeof raw === 'boolean' || typeof raw === 'number' ? String(raw) : ''
    if (!text) {
      if (column.required) throw new HttpError(400, `La colonne « ${column.label} » est obligatoire.`)
      continue
    }
    if (text.length > 2000) throw new HttpError(400, `La valeur de « ${column.label} » est trop longue.`)
    if (column.type === 'NUMBER' && !Number.isFinite(Number(text.replace(',', '.')))) throw new HttpError(400, `« ${column.label} » doit être un nombre.`)
    if (column.type === 'DATE' && !/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new HttpError(400, `« ${column.label} » doit être une date.`)
    if (column.type === 'TIME' && !/^\d{2}:\d{2}$/.test(text)) throw new HttpError(400, `« ${column.label} » doit être une heure.`)
    if (column.type === 'SELECT' && !column.options.includes(text)) throw new HttpError(400, `Choix invalide pour « ${column.label} ».`)
    values[column.id] = text
  }
  return values
}

sheetsRouter.get('/:id/rows', sheetsGate, async (req, res) => {
  const sheet = await findSheet(req.access, req.params.id)
  const rows = await prisma.sheetRow.findMany({ where: { sheetId: sheet.id }, orderBy: { createdAt: 'desc' }, take: MAX_ROWS, include: rowInclude })
  // Nombre de fichiers joints par ligne et par colonne « Action ».
  const counts = await prisma.sheetFile.groupBy({ by: ['rowId', 'columnId'], where: { rowId: { in: rows.map((row) => row.id) } }, _count: { _all: true } })
  const byRow = new Map()
  for (const entry of counts) byRow.set(entry.rowId, { ...byRow.get(entry.rowId), [entry.columnId]: entry._count._all })
  // Signalements non traités par ligne : la ligne est affichée en rouge tant qu'il en reste.
  const open = await prisma.sheetReport.groupBy({ by: ['rowId'], where: { rowId: { in: rows.map((row) => row.id) }, resolvedAt: null }, _count: { _all: true } })
  const openByRow = new Map(open.map((entry) => [entry.rowId, entry._count._all]))
  res.json({ rows: rows.map((row) => ({ ...rowDto(row, byRow.get(row.id)), openReports: openByRow.get(row.id) ?? 0 })) })
})

/** Signalements faits à propos d'une ligne (pour son panneau de détail). */
sheetsRouter.get('/:id/rows/:rowId/reports', sheetsGate, async (req, res) => {
  const sheet = await findSheet(req.access, req.params.id)
  const row = await findRow(sheet.id, req.params.rowId)
  const reports = await prisma.sheetReport.findMany({ where: { rowId: row.id }, orderBy: { createdAt: 'desc' }, include: { reporter: { select: { name: true } }, resolver: { select: { name: true } } } })
  const labels = { 2: 'Chef de poste', 3: 'Responsable sécurité', 5: 'Agent APS' }
  res.json({
    reports: reports.map((report) => ({
      id: report.id,
      reporter: report.reporter.name,
      toLabel: labels[report.toProfile] ?? '',
      message: report.message,
      createdAt: report.createdAt,
      resolved: report.resolvedAt !== null,
      resolvedBy: report.resolver?.name ?? null,
    })),
  })
})

sheetsRouter.post('/:id/rows', sheetsGate, async (req, res) => {
  const sheet = await findSheet(req.access, req.params.id)
  assertSheetAllows(req.access, sheet, 'create')
  const values = parseValues(sheet, req.body?.values)
  const row = await prisma.sheetRow.create({ data: { sheetId: sheet.id, values, createdBy: req.access.id }, include: rowInclude })
  res.status(201).json({ row: rowDto(row) })
})

async function findRow(sheetId, rowId) {
  const row = UUID.test(rowId) ? await prisma.sheetRow.findFirst({ where: { id: rowId, sheetId }, include: rowInclude }) : null
  if (!row) throw new HttpError(404, 'Ligne introuvable.')
  return row
}

sheetsRouter.put('/:id/rows/:rowId', sheetsGate, async (req, res) => {
  const sheet = await findSheet(req.access, req.params.id)
  assertSheetAllows(req.access, sheet, 'update')
  const row = await findRow(sheet.id, req.params.rowId)
  const values = parseValues(sheet, req.body?.values)
  const saved = await prisma.sheetRow.update({ where: { id: row.id }, data: { values }, include: rowInclude })
  res.json({ row: rowDto(saved) })
})

sheetsRouter.delete('/:id/rows/:rowId', sheetsGate, async (req, res) => {
  const sheet = await findSheet(req.access, req.params.id)
  assertSheetAllows(req.access, sheet, 'delete')
  const row = await findRow(sheet.id, req.params.rowId)
  await prisma.sheetRow.delete({ where: { id: row.id } })
  res.json({ id: row.id, deleted: true })
})

// -------------------------------------------------------------------- Fichiers joints (colonne Action)

const fileSummary = { id: true, name: true, extension: true, size: true, createdAt: true }

/** Colonne « Attacher des fichiers » de la feuille, désignée par `?columnId=`. */
function attachmentColumn(sheet, columnId) {
  const column = typeof columnId === 'string' && UUID.test(columnId) ? sheet.columns.find((candidate) => candidate.id === columnId) : null
  if (!column || column.type !== 'ACTION' || column.action !== 'ATTACH_FILES') throw new HttpError(400, "Cette colonne n'accepte pas de fichiers.")
  return column
}

sheetsRouter.get('/:id/rows/:rowId/files', sheetsGate, async (req, res) => {
  const sheet = await findSheet(req.access, req.params.id)
  const row = await findRow(sheet.id, req.params.rowId)
  const column = attachmentColumn(sheet, req.query.columnId)
  const files = await prisma.sheetFile.findMany({ where: { rowId: row.id, columnId: column.id }, orderBy: { createdAt: 'asc' }, select: fileSummary })
  res.json({ files })
})

// Joindre ou retirer un fichier modifie la ligne : permission « modifier ».
const editRows = requirePermission(['sheets'], { action: 'update' })

sheetsRouter.post('/:id/rows/:rowId/files', editRows, express.raw({ type: () => true, limit: MAX_FILE_BYTES }), async (req, res) => {
  const sheet = await findSheet(req.access, req.params.id)
  assertSheetAllows(req.access, sheet, 'update')
  const row = await findRow(sheet.id, req.params.rowId)
  const column = attachmentColumn(sheet, req.query.columnId)
  const { name, extension } = readFileName(req.headers['x-file-name'])
  const mimeType = ALLOWED_FILE_TYPES.get(extension)
  if (!name || !mimeType) throw new HttpError(400, 'Format de fichier non autorisé.')
  // Colonne réservée aux photos : seules les images sont acceptées.
  if (!column.allowUpload && !mimeType.startsWith('image/')) throw new HttpError(400, 'Cette colonne n\'accepte que des photos.')
  const content = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
  if (!content.length) throw new HttpError(400, 'Le fichier est vide.')
  if ((await prisma.sheetFile.count({ where: { rowId: row.id, columnId: column.id } })) >= MAX_FILES_PER_CELL) {
    throw new HttpError(409, `Une cellule accepte ${MAX_FILES_PER_CELL} fichiers au maximum.`)
  }
  const file = await prisma.sheetFile.create({
    data: { rowId: row.id, columnId: column.id, name, extension, mimeType, size: content.length, content, addedBy: req.access.id },
    select: fileSummary,
  })
  res.status(201).json({ file })
})

async function findFile(req, action) {
  const sheet = await findSheet(req.access, req.params.id)
  if (action) assertSheetAllows(req.access, sheet, action)
  const row = await findRow(sheet.id, req.params.rowId)
  const file = UUID.test(req.params.fileId) ? await prisma.sheetFile.findFirst({ where: { id: req.params.fileId, rowId: row.id } }) : null
  if (!file) throw new HttpError(404, 'Fichier introuvable.')
  return file
}

sheetsRouter.get('/:id/rows/:rowId/files/:fileId', sheetsGate, async (req, res) => {
  const file = await findFile(req)
  res
    .set({
      'Content-Type': file.mimeType,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name).replaceAll("'", '%27')}`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    .send(Buffer.from(file.content))
})

sheetsRouter.delete('/:id/rows/:rowId/files/:fileId', editRows, async (req, res) => {
  const file = await findFile(req, 'update')
  await prisma.sheetFile.delete({ where: { id: file.id } })
  res.json({ id: file.id, deleted: true })
})

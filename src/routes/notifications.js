import { Router } from 'express'
import { prisma } from '../config/prisma.js'
import { HttpError } from '../middleware/errors.js'
import { PROFILES } from '../permissions/catalog.js'
import { ESCALATION } from './reports.js'

/** Notifications de l'utilisateur connecté (/api/notifications) : chacun ne voit que les siennes. */
export const notificationsRouter = Router()

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LIMIT = 40

notificationsRouter.get('/', async (req, res) => {
  const { access } = req
  const [notes, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: access.id },
      orderBy: { createdAt: 'desc' },
      take: LIMIT,
      include: { report: { select: { siteId: true, sheetId: true, postId: true, rowId: true, toProfile: true, resolvedAt: true, children: { where: { reporterId: access.id }, select: { id: true } } } } },
    }),
    prisma.notification.count({ where: { userId: access.id, readAt: null } }),
  ])
  // Le lien vers la feuille n'est proposé que si l'utilisateur peut l'ouvrir (administrateur, ou affecté au poste) ; sinon le message de la notification suffit.
  const postIds = [...new Set(notes.flatMap((note) => (note.report ? [note.report.postId] : [])))]
  const assigned = access.profile === 1 ? null : new Set((await prisma.postUser.findMany({ where: { userId: access.id, postId: { in: postIds } }, select: { postId: true } })).map((row) => row.postId))
  const next = ESCALATION[access.profile]
  const canEscalateHere = access.permissions.has('sheets.report') && access.profile !== 1 && next !== undefined
  res.json({
    unread,
    escalateTo: canEscalateHere ? PROFILES[next] : null,
    notifications: notes.map((note) => ({
      id: note.id,
      type: note.type,
      title: note.title,
      body: note.body,
      createdAt: note.createdAt,
      read: note.readAt !== null,
      // Ouvrir la feuille met en avant la ligne signalée (paramètre `row`).
      link: note.report && (assigned === null || assigned.has(note.report.postId)) ? `/sites/${note.report.siteId}/feuilles/${note.report.sheetId}${note.report.rowId ? `?row=${note.report.rowId}` : ''}` : null,
      reportId: note.reportId,
      status: note.report ? (note.report.resolvedAt ? 'resolved' : 'open') : null,
      // Un destinataire (ou l'administrateur) peut marquer un signalement ouvert comme traité.
      canResolve: Boolean(note.report && note.type === 'REPORT' && !note.report.resolvedAt),
      // Transmissible si le signalement est adressé à ce niveau et que l'utilisateur ne l'a pas déjà transmis.
      canEscalate: Boolean(note.report && note.type === 'REPORT' && !note.report.resolvedAt && canEscalateHere && note.report.toProfile === access.profile && note.report.children.length === 0),
    })),
  })
})

notificationsRouter.post('/read-all', async (req, res) => {
  const { count } = await prisma.notification.updateMany({ where: { userId: req.access.id, readAt: null }, data: { readAt: new Date() } })
  res.json({ updated: count })
})

notificationsRouter.post('/:id/read', async (req, res) => {
  if (!UUID.test(req.params.id)) throw new HttpError(404, 'Notification introuvable.')
  const { count } = await prisma.notification.updateMany({ where: { id: req.params.id, userId: req.access.id, readAt: null }, data: { readAt: new Date() } })
  res.json({ updated: count })
})

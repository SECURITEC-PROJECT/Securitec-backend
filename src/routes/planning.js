import { Router } from 'express'
import { prisma } from '../config/prisma.js'
import { requirePermission } from '../middleware/auth.js'
import { HttpError } from '../middleware/errors.js'

/** Planning du personnel : /api/planning, réservé à `planning.*`. Il couvre toute l'agence (tous les sites). */
export const planningRouter = Router()
planningRouter.use(requirePermission(['planning']))

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_SHIFT_MS = 24 * 3600 * 1000 // une vacation ne dépasse pas 24 h
const MAX_RANGE_MS = 62 * 24 * 3600 * 1000 // on ne charge pas plus de deux mois à la fois

const include = {
  user: { select: { id: true, name: true, matricule: true } },
  site: { select: { id: true, name: true } },
  post: { select: { id: true, name: true } },
}

const shiftDto = (shift) => ({
  id: shift.id,
  userId: shift.userId,
  userName: shift.user.name,
  matricule: shift.user.matricule,
  siteId: shift.siteId,
  siteName: shift.site.name,
  postId: shift.postId,
  postName: shift.post?.name ?? null,
  startsAt: shift.startsAt.toISOString(),
  endsAt: shift.endsAt.toISOString(),
  note: shift.note,
})

const parseDate = (value, label) => {
  const date = typeof value === 'string' ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) throw new HttpError(400, `${label} est invalide.`)
  return date
}

/** Valide le corps d'une vacation et renvoie les données à enregistrer. */
async function parseShift(body) {
  const { userId, siteId } = body ?? {}
  const postId = body?.postId || null
  if (!UUID.test(userId ?? '') || !UUID.test(siteId ?? '')) throw new HttpError(400, 'Choisissez un utilisateur et un site.')
  if (postId !== null && !UUID.test(postId)) throw new HttpError(400, 'Le poste est invalide.')
  const startsAt = parseDate(body?.startsAt, 'La date de début')
  const endsAt = parseDate(body?.endsAt, 'La date de fin')
  if (endsAt <= startsAt) throw new HttpError(400, 'La fin doit être après le début.')
  if (endsAt - startsAt > MAX_SHIFT_MS) throw new HttpError(400, 'Une vacation dure 24 h au maximum.')
  const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 500) : ''

  if (!(await prisma.user.findFirst({ where: { id: userId, active: true }, select: { id: true } }))) throw new HttpError(404, 'Utilisateur introuvable ou désactivé.')
  if (!(await prisma.site.findFirst({ where: { id: siteId, active: true }, select: { id: true } }))) throw new HttpError(404, 'Site introuvable ou inactif.')
  if (postId && !(await prisma.post.findFirst({ where: { id: postId, siteId, active: true }, select: { id: true } }))) {
    throw new HttpError(400, 'Ce poste n’appartient pas au site choisi.')
  }
  return { userId, siteId, postId, startsAt, endsAt, note }
}

/** Une personne ne peut pas être à deux endroits en même temps. */
async function assertNoOverlap({ userId, startsAt, endsAt }, ignoreId) {
  const clash = await prisma.shift.findFirst({
    where: { userId, startsAt: { lt: endsAt }, endsAt: { gt: startsAt }, ...(ignoreId ? { id: { not: ignoreId } } : {}) },
    include: { site: { select: { name: true } } },
  })
  if (clash) {
    const fmt = (date) => date.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' })
    throw new HttpError(409, `Cette personne est déjà en poste sur « ${clash.site.name} » (${fmt(clash.startsAt)} → ${fmt(clash.endsAt)}).`)
  }
}

/** Être planifié sur un poste = être affecté au poste (il voit alors ses feuilles de saisie et apparaît dans ses paramètres). */
async function assignToPost({ postId, userId }) {
  if (!postId) return
  await prisma.postUser.upsert({ where: { postId_userId: { postId, userId } }, create: { postId, userId }, update: {} })
}

async function findShift(id) {
  const shift = UUID.test(id) ? await prisma.shift.findUnique({ where: { id }, include }) : null
  if (!shift) throw new HttpError(404, 'Vacation introuvable.')
  return shift
}

/** Ce qu'il faut pour remplir les filtres et le formulaire : comptes actifs, sites et postes actifs. */
planningRouter.get('/options', async (_req, res) => {
  const [users, sites, posts] = await Promise.all([
    prisma.user.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, matricule: true, siteId: true } }),
    prisma.site.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.post.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, siteId: true } }),
  ])
  res.json({ users, sites, posts })
})

/** Vacations qui touchent la période [from, to[ ; filtres facultatifs `siteId` et `userId`. */
planningRouter.get('/', async (req, res) => {
  const from = parseDate(req.query.from, 'La date de début')
  const to = parseDate(req.query.to, 'La date de fin')
  if (to <= from || to - from > MAX_RANGE_MS) throw new HttpError(400, 'La période demandée est invalide (deux mois au maximum).')
  const where = { startsAt: { lt: to }, endsAt: { gt: from } }
  for (const key of ['siteId', 'userId']) {
    const value = req.query[key]
    if (value) {
      if (typeof value !== 'string' || !UUID.test(value)) throw new HttpError(400, 'Filtre invalide.')
      where[key] = value
    }
  }
  const shifts = await prisma.shift.findMany({ where, include, orderBy: [{ startsAt: 'asc' }, { user: { name: 'asc' } }] })
  res.json({ shifts: shifts.map(shiftDto) })
})

planningRouter.post('/', async (req, res) => {
  const data = await parseShift(req.body)
  await assertNoOverlap(data)
  const shift = await prisma.shift.create({ data, include })
  await assignToPost(data)
  res.status(201).json({ shift: shiftDto(shift) })
})

planningRouter.put('/:id', async (req, res) => {
  const current = await findShift(req.params.id)
  const data = await parseShift(req.body)
  await assertNoOverlap(data, current.id)
  const shift = await prisma.shift.update({ where: { id: current.id }, data, include })
  await assignToPost(data)
  res.json({ shift: shiftDto(shift) })
})

planningRouter.delete('/:id', async (req, res) => {
  const current = await findShift(req.params.id)
  await prisma.shift.delete({ where: { id: current.id } })
  res.json({ id: current.id, deleted: true })
})

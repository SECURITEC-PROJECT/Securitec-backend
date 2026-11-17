import { Router } from 'express'
import { prisma } from '../config/prisma.js'
import { requirePermission } from '../middleware/auth.js'
import { HttpError } from '../middleware/errors.js'

/** Postes de garde : /api/admin/posts, réservé à `administration.*`. Hors administrateur, on ne voit que les postes de son site. */
export const postsRouter = Router()
postsRouter.use(requirePermission(['administration']))

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const include = { site: { select: { name: true } }, assignees: { select: { user: { select: { id: true, name: true, active: true } } } } }

/** Un poste tel que l'interface l'attend : `users` = les comptes actifs affectés au poste. */
const postDto = (post, counts = { day: 0, night: 0 }, schedules = new Map()) => ({
  id: post.id,
  siteId: post.siteId,
  nom: post.name,
  actif: post.active,
  siteName: post.site.name,
  dayCount: counts.day,
  nightCount: counts.night,
  users: post.assignees
    .map((assignment) => assignment.user)
    .filter((user) => user.active)
    // `shifts` : les prochaines vacations de la personne sur ce poste (le planning et les affectations sont liés).
    .map(({ id, name }) => ({ id, name, shifts: schedules.get(`${post.id}:${id}`) ?? [] }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr')),
})

const cleanName = (value) => (typeof value === 'string' ? value.trim().slice(0, 160) : '')

function assertSiteScope(access, siteId) {
  if (access.profile !== 1 && siteId !== access.siteId) throw new HttpError(403, 'Vous ne pouvez gérer que les postes de votre site.')
}

async function findPost(access, id) {
  const post = UUID.test(id) ? await prisma.post.findUnique({ where: { id }, include }) : null
  if (!post) throw new HttpError(404, 'Poste introuvable.')
  assertSiteScope(access, post.siteId)
  return post
}

const duplicate = (error) => {
  if (error.code === 'P2002') throw new HttpError(409, 'Un poste porte déjà ce nom sur ce site.')
  throw error
}

/** Valide la liste des utilisateurs à affecter : des comptes actifs du site du poste, sans doublon. */
async function parseUserIds(value) {
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || !UUID.test(id))) throw new HttpError(400, 'La liste des utilisateurs est invalide.')
  const ids = [...new Set(value)]
  // Un employé planifié depuis un autre site peut être affecté au poste : seul le compte actif compte.
  if (ids.length > 0 && (await prisma.user.count({ where: { id: { in: ids }, active: true } })) !== ids.length) {
    throw new HttpError(400, 'Les utilisateurs affectés doivent être des comptes actifs.')
  }
  return ids
}

const SCHEDULE_DAYS = 7

/** Prochaines vacations (7 jours) de chaque personne sur chaque poste, indexées par « poste:utilisateur ». */
async function loadSchedules(postIds) {
  const schedules = new Map()
  if (postIds.length === 0) return schedules
  const now = new Date()
  const shifts = await prisma.shift.findMany({
    where: { postId: { in: postIds }, endsAt: { gt: now }, startsAt: { lt: new Date(now.getTime() + SCHEDULE_DAYS * 24 * 3600 * 1000) } },
    orderBy: { startsAt: 'asc' },
    select: { id: true, postId: true, userId: true, startsAt: true, endsAt: true },
  })
  for (const shift of shifts) {
    const key = `${shift.postId}:${shift.userId}`
    schedules.set(key, [...(schedules.get(key) ?? []), { id: shift.id, startsAt: shift.startsAt.toISOString(), endsAt: shift.endsAt.toISOString() }])
  }
  return schedules
}

/** Fenêtre « jour » et « nuit » demandée par le client (ISO), ou null : le client connaît son fuseau horaire. */
function parseWindows(query) {
  const read = (key) => {
    const date = typeof query[key] === 'string' ? new Date(query[key]) : null
    return date && !Number.isNaN(date.getTime()) ? date : null
  }
  const [dayFrom, dayTo, nightFrom, nightTo] = ['dayFrom', 'dayTo', 'nightFrom', 'nightTo'].map(read)
  return dayFrom && dayTo && nightFrom && nightTo ? { dayFrom, dayTo, nightFrom, nightTo } : null
}

/** Nombre de personnes distinctes planifiées sur chaque poste, de jour et de nuit (sans leurs noms). */
async function countShifts(postIds, windows) {
  const counts = new Map(postIds.map((id) => [id, { day: new Set(), night: new Set() }]))
  if (!windows || postIds.length === 0) return counts
  const shifts = await prisma.shift.findMany({
    where: { postId: { in: postIds }, startsAt: { lt: windows.nightTo }, endsAt: { gt: windows.dayFrom } },
    select: { postId: true, userId: true, startsAt: true, endsAt: true },
  })
  // Chaque vacation est rangée dans UNE seule catégorie : celle où elle passe le plus de temps (une vacation de 16 h à 8 h est « de nuit »).
  const overlap = (shift, from, to) => Math.max(0, Math.min(shift.endsAt, to) - Math.max(shift.startsAt, from))
  for (const shift of shifts) {
    const day = overlap(shift, windows.dayFrom, windows.dayTo)
    const night = overlap(shift, windows.nightFrom, windows.nightTo)
    if (day === 0 && night === 0) continue
    counts.get(shift.postId)[day >= night ? 'day' : 'night'].add(shift.userId)
  }
  return counts
}

postsRouter.get('/', async (req, res) => {
  const where = req.access.profile === 1 ? {} : { siteId: req.access.siteId ?? '' }
  const posts = await prisma.post.findMany({ where, include, orderBy: [{ site: { name: 'asc' } }, { name: 'asc' }] })
  const postIds = posts.map((post) => post.id)
  const [counts, schedules] = await Promise.all([countShifts(postIds, parseWindows(req.query)), loadSchedules(postIds)])
  res.json({ posts: posts.map((post) => postDto(post, { day: counts.get(post.id).day.size, night: counts.get(post.id).night.size }, schedules)) })
})

/** Comptes actifs d'un site, proposés pour l'affectation à un poste. */
postsRouter.get('/assignable-users', async (req, res) => {
  const siteId = String(req.query.siteId ?? '')
  if (!UUID.test(siteId)) throw new HttpError(400, 'Indiquez le site.')
  assertSiteScope(req.access, siteId)
  const users = await prisma.user.findMany({ where: { siteId, active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, identifier: true } })
  res.json({ users })
})

postsRouter.post('/', async (req, res) => {
  const name = cleanName(req.body?.nom)
  const siteId = req.body?.siteId
  if (!UUID.test(siteId ?? '') || !name) throw new HttpError(400, 'Choisissez un site et indiquez le nom du poste.')
  assertSiteScope(req.access, siteId)
  if (!(await prisma.site.findFirst({ where: { id: siteId, active: true }, select: { id: true } }))) throw new HttpError(404, 'Site introuvable ou inactif.')
  const userIds = req.body?.userIds === undefined ? [] : await parseUserIds(req.body.userIds)
  const post = await prisma.post.create({ data: { siteId, name, assignees: { create: userIds.map((userId) => ({ userId })) } }, include }).catch(duplicate)
  res.status(201).json({ post: postDto(post) })
})

/** `userIds` absent = affectations inchangées ; une liste (même vide) remplace les affectations. */
postsRouter.put('/:id', async (req, res) => {
  const current = await findPost(req.access, req.params.id)
  const name = cleanName(req.body?.nom)
  if (!name || typeof req.body?.actif !== 'boolean') throw new HttpError(400, 'Indiquez un nom valide et un état actif.')
  const data = { name, active: req.body.actif }
  if (req.body.userIds !== undefined) {
    const userIds = await parseUserIds(req.body.userIds)
    data.assignees = { deleteMany: {}, create: userIds.map((userId) => ({ userId })) }
    // Une personne retirée du poste n'y est plus planifiée : ses vacations à venir restent sur le site, sans poste.
    await prisma.shift.updateMany({ where: { postId: current.id, userId: { notIn: userIds }, endsAt: { gt: new Date() } }, data: { postId: null } })
  }
  const post = await prisma.post.update({ where: { id: current.id }, data, include }).catch(duplicate)
  res.json({ post: postDto(post) })
})

/** Désactivation : un poste n'est jamais supprimé, ses données d'exploitation futures s'y rattachent. */
postsRouter.delete('/:id', async (req, res) => {
  const current = await findPost(req.access, req.params.id)
  if (!current.active) throw new HttpError(404, 'Poste introuvable ou déjà désactivé.')
  await prisma.post.update({ where: { id: current.id }, data: { active: false } })
  res.json({ id: current.id, deactivated: true })
})

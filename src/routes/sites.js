import express, { Router } from 'express'
import { detectImageType } from '../config/files.js'
import { prisma } from '../config/prisma.js'
import { requirePermission } from '../middleware/auth.js'
import { HttpError } from '../middleware/errors.js'

export const sitesRouter = Router()

const SITE_TYPES = ['USINE', 'AGENCE']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const select = { id: true, name: true, type: true, address: true, createdAt: true }

/** Valide le corps d'une création de site et renvoie des valeurs nettoyées. */
function parseNewSite(body) {
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const address = typeof body?.address === 'string' ? body.address.trim() : ''
  if (!name) throw new HttpError(400, 'Le nom du site est obligatoire.')
  if (name.length > 255) throw new HttpError(400, 'Le nom du site est trop long (255 caractères maximum).')
  if (!SITE_TYPES.includes(body?.type)) throw new HttpError(400, 'Le type du site doit être USINE ou AGENCE.')
  if (address.length > 2000) throw new HttpError(400, "L'adresse est trop longue (2000 caractères maximum).")
  return { name, type: body.type, address }
}

/** Un administrateur voit tous les sites ; les autres profils ne voient que le leur. */
const visibleTo = (access) => (access.profile === 1 ? {} : { id: access.siteId ?? '' })

/** Charge un site actif visible par l'utilisateur à partir de l'identifiant de l'adresse, ou répond 404. */
async function findSite(access, id) {
  const site = UUID.test(id) ? await prisma.site.findFirst({ where: { id, active: true, ...visibleTo(access) }, select }) : null
  if (!site) throw new HttpError(404, 'Site introuvable.')
  return site
}

sitesRouter.get('/', async (req, res) => {
  const sites = await prisma.site.findMany({ where: { active: true, ...visibleTo(req.access) }, orderBy: { createdAt: 'asc' }, select })
  res.json({ sites })
})

sitesRouter.post('/', requirePermission(['administration']), async (req, res) => {
  const data = parseNewSite(req.body)
  const duplicate = await prisma.site.findFirst({ where: { name: { equals: data.name, mode: 'insensitive' } }, select: { id: true } })
  if (duplicate) throw new HttpError(409, 'Un site portant ce nom existe déjà.')
  const site = await prisma.site.create({ data, select })
  res.status(201).json({ site })
})

sitesRouter.get('/:id', async (req, res) => {
  res.json({ site: await findSite(req.access, req.params.id) })
})

sitesRouter.get('/:id/users', requirePermission(['users']), async (req, res) => {
  const site = await findSite(req.access, req.params.id)
  const users = await prisma.user.findMany({
    where: { siteId: site.id },
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
    select: { id: true, name: true, identifier: true, matricule: true, active: true, createdAt: true, role: { select: { name: true } } },
  })
  res.json({ users: users.map(({ role, ...user }) => ({ ...user, roleName: role.name })) })
})

// ------------------------------------------------------------------------------------------ Logo du site

const MAX_LOGO_BYTES = 1024 * 1024

const rawBody = express.raw({ type: () => true, limit: MAX_LOGO_BYTES })

sitesRouter.get('/:id/logo', async (req, res) => {
  const site = await findSite(req.access, req.params.id)
  const logo = await prisma.siteLogo.findUnique({ where: { siteId: site.id } })
  if (!logo) throw new HttpError(404, "Ce site n'a pas de logo.")
  res
    .set({ 'Content-Type': logo.mimeType, 'Cache-Control': 'private, no-cache', 'X-Content-Type-Options': 'nosniff' })
    .send(Buffer.from(logo.content))
})

sitesRouter.put('/:id/logo', requirePermission(['administration'], { action: 'update' }), rawBody, async (req, res) => {
  const site = await findSite(req.access, req.params.id)
  const content = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
  const mimeType = detectImageType(content)
  if (!mimeType) throw new HttpError(400, 'Le logo doit être une image PNG, JPEG ou WebP.')
  const data = { mimeType, content, size: content.length, userId: req.access.id, updatedAt: new Date() }
  await prisma.siteLogo.upsert({ where: { siteId: site.id }, create: { siteId: site.id, ...data }, update: data })
  res.json({ saved: true, size: content.length })
})

sitesRouter.delete('/:id/logo', requirePermission(['administration'], { action: 'update' }), async (req, res) => {
  const site = await findSite(req.access, req.params.id)
  await prisma.siteLogo.deleteMany({ where: { siteId: site.id } })
  res.json({ deleted: true })
})

import { Router } from 'express'
import { prisma } from '../config/prisma.js'
import { requirePermission } from '../middleware/auth.js'
import { HttpError } from '../middleware/errors.js'

/**
 * Comptes rendus d'un site (/api/minutes) : des pages libres où l'on place du texte et des tableaux tirés des feuilles de saisie.
 * La mise en page est un document JSON (`layout`) que le frontend interprète ; le backend ne valide que sa forme générale et sa taille.
 * Les lignes des feuilles ne passent pas par ici : le tableau les charge via /api/sheets, qui applique déjà ses règles d'accès.
 */
export const minutesRouter = Router()
minutesRouter.use(requirePermission(['minutes']))

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_LAYOUT_BYTES = 10_000_000
const MAX_BLOCKS = 80

const cleanName = (value) => (typeof value === 'string' ? value.trim().slice(0, 160) : '')

function assertSiteScope(access, siteId) {
  if (access.profile !== 1 && siteId !== access.siteId) throw new HttpError(403, "Vous ne pouvez accéder qu'aux comptes rendus de votre site.")
}

async function findMinutes(access, id) {
  const minutes = UUID.test(id) ? await prisma.minutes.findUnique({ where: { id } }) : null
  if (!minutes) throw new HttpError(404, 'Compte rendu introuvable.')
  assertSiteScope(access, minutes.siteId)
  return minutes
}

const summary = (minutes) => ({ id: minutes.id, siteId: minutes.siteId, name: minutes.name, updatedAt: minutes.updatedAt })
const detail = (minutes) => ({ ...summary(minutes), layout: minutes.layout })

function parseLayout(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'La mise en page est invalide.')
  if (!Array.isArray(input.blocks) || input.blocks.length > MAX_BLOCKS) throw new HttpError(400, `Un compte rendu compte ${MAX_BLOCKS} blocs au maximum.`)
  if (Buffer.byteLength(JSON.stringify(input)) > MAX_LAYOUT_BYTES) throw new HttpError(400, 'Le compte rendu est trop volumineux.')
  return input
}

minutesRouter.get('/', async (req, res) => {
  const siteId = typeof req.query.siteId === 'string' ? req.query.siteId : ''
  if (!UUID.test(siteId)) throw new HttpError(400, 'Indiquez le site.')
  assertSiteScope(req.access, siteId)
  const list = await prisma.minutes.findMany({ where: { siteId }, orderBy: { updatedAt: 'desc' } })
  res.json({ minutes: list.map(summary) })
})

minutesRouter.get('/:id', async (req, res) => {
  res.json({ minutes: detail(await findMinutes(req.access, req.params.id)) })
})

minutesRouter.post('/', async (req, res) => {
  const { siteId } = req.body ?? {}
  const name = cleanName(req.body?.name)
  if (!UUID.test(siteId ?? '') || !name) throw new HttpError(400, 'Indiquez le site et le nom du compte rendu.')
  assertSiteScope(req.access, siteId)
  if (!(await prisma.site.findFirst({ where: { id: siteId, active: true }, select: { id: true } }))) throw new HttpError(404, 'Site introuvable ou inactif.')
  const created = await prisma.minutes.create({ data: { siteId, name, layout: { page: { orientation: 'portrait' }, blocks: [] }, createdBy: req.access.id } })
  res.status(201).json({ minutes: detail(created) })
})

minutesRouter.put('/:id', async (req, res) => {
  const current = await findMinutes(req.access, req.params.id)
  const name = cleanName(req.body?.name) || current.name
  const layout = req.body?.layout === undefined ? current.layout : parseLayout(req.body.layout)
  res.json({ minutes: detail(await prisma.minutes.update({ where: { id: current.id }, data: { name, layout } })) })
})

minutesRouter.delete('/:id', async (req, res) => {
  const current = await findMinutes(req.access, req.params.id)
  await prisma.minutes.delete({ where: { id: current.id } })
  res.json({ id: current.id, deleted: true })
})

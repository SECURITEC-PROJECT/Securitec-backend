import { Router } from 'express'
import { prisma } from '../config/prisma.js'
import { HttpError } from '../middleware/errors.js'
import { requirePermission } from '../middleware/auth.js'
import { clearAccessCache } from '../permissions/access.js'
import { PROFILES, isKnownPermission } from '../permissions/catalog.js'

export const rolesRouter = Router()
rolesRouter.use(requirePermission(['roles']))

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const clean = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '')

const slugify = (value) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)

/** Un rôle tel que l'interface l'attend (noms de champs de l'écran « Rôles et permissions »). */
const roleDto = (role) => ({
  id: role.id,
  code: role.code,
  nom: role.name,
  description: role.description,
  profilBase: role.baseProfile,
  system: role.system,
})

const detail = async (id) => {
  const role = await prisma.accessRole.findFirst({ where: { id, active: true }, include: { permissions: { orderBy: { permission: 'asc' } } } })
  return role ? { ...roleDto(role), permissions: role.permissions.map((row) => row.permission) } : null
}

function readFields(body) {
  const name = clean(body?.nom, 120)
  const description = clean(body?.description, 500)
  const baseProfile = Number(body?.profilBase)
  const permissions = Array.isArray(body?.permissions) ? [...new Set(body.permissions)] : null
  if (!name) throw new HttpError(400, 'Indiquez le nom du rôle.')
  if (!Object.keys(PROFILES).map(Number).includes(baseProfile)) throw new HttpError(400, 'Le profil de base est invalide.')
  if (!permissions || !permissions.every((permission) => typeof permission === 'string' && isKnownPermission(permission))) {
    throw new HttpError(400, 'La liste des permissions est invalide.')
  }
  return { name, description: description || null, baseProfile, permissions }
}

async function uniqueCode(name) {
  const base = slugify(name) || 'role'
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = attempt === 0 ? base : `${base}_${attempt + 1}`
    if (!(await prisma.accessRole.findUnique({ where: { code }, select: { id: true } }))) return code
  }
  return `${base}_${Date.now()}`
}

const replacePermissions = (roleId, permissions) => [
  prisma.rolePermission.deleteMany({ where: { roleId } }),
  prisma.rolePermission.createMany({ data: permissions.map((permission) => ({ roleId, permission })) }),
]

function idParam(req) {
  if (!UUID.test(req.params.id)) throw new HttpError(404, 'Rôle introuvable.')
  return req.params.id
}

rolesRouter.get('/', async (_req, res) => {
  const roles = await prisma.accessRole.findMany({
    where: { active: true },
    orderBy: [{ system: 'desc' }, { baseProfile: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { permissions: true } }, users: { where: { active: true }, select: { id: true } } },
  })
  res.json({ roles: roles.map((role) => ({ ...roleDto(role), permissionCount: role._count.permissions, userCount: role.users.length })) })
})

rolesRouter.post('/', async (req, res) => {
  const { permissions, ...fields } = readFields(req.body)
  const role = await prisma.accessRole.create({ data: { ...fields, code: await uniqueCode(fields.name), permissions: { create: permissions.map((permission) => ({ permission })) } } })
  clearAccessCache()
  res.status(201).json({ role: await detail(role.id) })
})

rolesRouter.get('/:id', async (req, res) => {
  const role = await detail(idParam(req))
  if (!role) throw new HttpError(404, 'Rôle introuvable.')
  res.json({ role })
})

rolesRouter.put('/:id', async (req, res) => {
  const id = idParam(req)
  const current = await detail(id)
  if (!current) throw new HttpError(404, 'Rôle introuvable.')
  const { permissions, ...fields } = readFields(req.body)
  if (current.system && current.profilBase === 1) {
    throw new HttpError(409, 'Le rôle Administrateur ne peut pas être modifié : il garantit un accès complet.')
  }
  // Un rôle système garde son profil de base ; seuls son libellé et ses permissions évoluent.
  const baseProfile = current.system ? current.profilBase : fields.baseProfile
  await prisma.$transaction([
    prisma.accessRole.update({ where: { id }, data: { name: fields.name, description: fields.description, baseProfile } }),
    ...replacePermissions(id, permissions),
    // Le profil de base pilote le périmètre de sites : il suit le rôle.
    prisma.user.updateMany({ where: { roleId: id }, data: { profile: baseProfile } }),
  ])
  clearAccessCache()
  res.json({ role: await detail(id) })
})

rolesRouter.delete('/:id', async (req, res) => {
  const id = idParam(req)
  const current = await detail(id)
  if (!current) throw new HttpError(404, 'Rôle introuvable.')
  if (current.system) throw new HttpError(409, 'Un rôle système ne peut pas être supprimé.')
  const usage = await prisma.user.count({ where: { roleId: id, active: true } })
  if (usage > 0) throw new HttpError(409, `Ce rôle est attribué à ${usage} utilisateur(s). Réaffectez-les d'abord.`)
  await prisma.accessRole.update({ where: { id }, data: { active: false } })
  clearAccessCache()
  res.json({ id, deleted: true })
})

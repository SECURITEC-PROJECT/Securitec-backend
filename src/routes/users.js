import bcrypt from 'bcryptjs'
import express, { Router } from 'express'
import { ALLOWED_FILE_TYPES, MAX_FILE_BYTES, detectImageType, readFileName } from '../config/files.js'
import { prisma } from '../config/prisma.js'
import { requirePermission } from '../middleware/auth.js'
import { HttpError } from '../middleware/errors.js'
import { clearAccessCache, getUserAccess } from '../permissions/access.js'
import { ALL_PERMISSIONS } from '../permissions/catalog.js'

export const usersRouter = Router()
// Joindre ou retirer un document modifie la fiche du compte : permission « modifier » (et non « créer » / « supprimer »).
const usersGate = requirePermission(['users'])
const documentsGate = (req, res, next) => requirePermission(['users'], { action: req.method === 'GET' ? 'view' : 'update' })(req, res, next)
usersRouter.use((req, res, next) => (/^\/[^/]+\/(documents(\/|$)|photo$)/.test(req.path) ? documentsGate(req, res, next) : usersGate(req, res, next)))

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const include = { site: { select: { name: true } }, role: { select: { name: true } } }

/** Un compte tel que l'interface l'attend. */
const userDto = (user) => ({
  id: user.id,
  name: user.name,
  identifier: user.identifier,
  matricule: user.matricule,
  profile: user.profile,
  active: user.active,
  siteId: user.siteId,
  siteName: user.site?.name ?? null,
  roleAccessId: user.roleId,
  roleAccessName: user.role.name,
})

function readFields(body, { creating }) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Les informations du compte sont invalides.')
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 255) : ''
  const identifier = typeof body.identifier === 'string' ? body.identifier.trim().toLocaleLowerCase().slice(0, 100) : ''
  const roleId = typeof body.roleAccessId === 'string' ? body.roleAccessId : ''
  const siteId = typeof body.siteId === 'string' && body.siteId ? body.siteId : null
  const pin = typeof body.pin === 'string' ? body.pin : ''
  const active = typeof body.active === 'boolean' ? body.active : undefined

  const matricule = typeof body.matricule === 'string' ? body.matricule.trim() : ''
  if (!name || !identifier) throw new HttpError(400, "Indiquez le nom et l'identifiant.")
  if (!matricule) throw new HttpError(400, "Indiquez le matricule de l'utilisateur.")
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,49}$/.test(matricule)) throw new HttpError(400, 'Le matricule ne peut contenir que des lettres, des chiffres et . - _ / (50 caractères maximum).')
  if (!UUID.test(roleId)) throw new HttpError(400, 'Choisissez un rôle.')
  if ((creating || pin) && !/^\d{6}$/.test(pin)) throw new HttpError(400, 'Le PIN doit contenir exactement 6 chiffres.')
  if (siteId && !UUID.test(siteId)) throw new HttpError(400, 'Le site sélectionné est invalide.')
  return { name, identifier, matricule, roleId, siteId, pin, active }
}

/** Rôle à attribuer : il doit exister et l'auteur doit détenir toutes ses permissions (pas d'élévation de privilèges). */
async function resolveRole(access, roleId) {
  const role = await prisma.accessRole.findFirst({ where: { id: roleId, active: true }, include: { permissions: true } })
  if (!role) throw new HttpError(400, 'Le rôle sélectionné est introuvable.')
  if (role.permissions.some((row) => !access.permissions.has(row.permission))) {
    throw new HttpError(403, 'Vous ne pouvez pas attribuer un rôle qui dépasse vos propres permissions.')
  }
  return role
}

async function ensureSite(siteId) {
  if (siteId && !(await prisma.site.findFirst({ where: { id: siteId, active: true }, select: { id: true } }))) {
    throw new HttpError(400, 'Le site sélectionné est introuvable ou inactif.')
  }
}

/** Hors administrateur, on ne gère que les comptes de son propre site. */
function assertSiteScope(access, siteId) {
  if (access.profile !== 1 && siteId !== access.siteId) throw new HttpError(403, 'Vous ne pouvez gérer que les comptes de votre site.')
}

/**
 * L'identifiant et le matricule servent tous deux à se connecter : aucun des deux ne doit correspondre
 * à l'identifiant ou au matricule d'un AUTRE compte (sinon la connexion serait ambiguë).
 */
async function assertLoginNamesFree({ identifier, matricule }, exceptId) {
  const same = (value) => ({ equals: value, mode: 'insensitive' })
  const clash = await prisma.user.findFirst({
    where: {
      ...(exceptId && { NOT: { id: exceptId } }),
      OR: [{ identifier: same(identifier) }, { identifier: same(matricule) }, { matricule: same(identifier) }, { matricule: same(matricule) }],
    },
    select: { identifier: true, matricule: true },
  })
  if (!clash) return
  const is = (a, b) => a.toLowerCase() === b.toLowerCase()
  if (is(clash.identifier, identifier)) throw new HttpError(409, 'Cet identifiant existe déjà.')
  if (is(clash.matricule, matricule)) throw new HttpError(409, 'Ce matricule est déjà attribué à un autre utilisateur.')
  throw new HttpError(409, "Cet identifiant ou ce matricule est déjà utilisé par un autre compte (l'un sert aussi à se connecter comme l'autre).")
}

const countActiveAdmins = () => prisma.user.count({ where: { profile: 1, active: true } })

function idParam(req) {
  if (!UUID.test(req.params.id)) throw new HttpError(404, 'Utilisateur introuvable.')
  return req.params.id
}

usersRouter.get('/', async (req, res) => {
  const where = req.access.profile === 1 ? {} : { siteId: req.access.siteId }
  const users = await prisma.user.findMany({ where, include, orderBy: [{ active: 'desc' }, { name: 'asc' }, { identifier: 'asc' }] })
  res.json({ users: users.map(userDto) })
})

usersRouter.post('/', async (req, res) => {
  const fields = readFields(req.body, { creating: true })
  const role = await resolveRole(req.access, fields.roleId)
  if (role.baseProfile !== 1 && !fields.siteId) throw new HttpError(400, 'Un site est obligatoire pour ce rôle.')
  assertSiteScope(req.access, fields.siteId)
  await ensureSite(fields.siteId)
  await assertLoginNamesFree(fields)
  const user = await prisma.user.create({
    data: {
      name: fields.name,
      identifier: fields.identifier,
      matricule: fields.matricule,
      pinHash: await bcrypt.hash(fields.pin, 12),
      profile: role.baseProfile,
      siteId: fields.siteId,
      roleId: fields.roleId,
    },
    include,
  })
  clearAccessCache()
  res.status(201).json({ user: userDto(user) })
})

usersRouter.put('/:id', async (req, res) => {
  const id = idParam(req)
  const fields = readFields(req.body, { creating: false })
  const existing = await prisma.user.findUnique({ where: { id } })
  // Un compte désactivé n'est modifiable que pour être réactivé.
  if (!existing || (!existing.active && fields.active !== true)) throw new HttpError(404, 'Utilisateur introuvable.')
  assertSiteScope(req.access, existing.siteId)
  if (existing.profile === 1 && req.access.profile !== 1) throw new HttpError(403, 'Seul un administrateur peut modifier un compte administrateur.')

  const role = await resolveRole(req.access, fields.roleId)
  if (role.baseProfile !== 1 && !fields.siteId) throw new HttpError(400, 'Un site est obligatoire pour ce rôle.')
  assertSiteScope(req.access, fields.siteId)
  await ensureSite(fields.siteId)
  await assertLoginNamesFree(fields, id)
  if (existing.profile === 1 && role.baseProfile !== 1) {
    if (id === req.access.id) throw new HttpError(400, 'Vous ne pouvez pas retirer votre propre rôle administrateur.')
    if ((await countActiveAdmins()) <= 1) throw new HttpError(409, 'Le dernier administrateur ne peut pas être rétrogradé.')
  }

  // Changer de rôle repart des droits du nouveau rôle : les ajustements individuels sont effacés.
  const update = prisma.user.update({
    where: { id },
    data: {
      name: fields.name,
      identifier: fields.identifier,
      matricule: fields.matricule,
      profile: role.baseProfile,
      siteId: fields.siteId,
      roleId: fields.roleId,
      ...(fields.pin && { pinHash: await bcrypt.hash(fields.pin, 12) }),
      ...(fields.active !== undefined && { active: fields.active }),
    },
    include,
  })
  const results = await prisma.$transaction(existing.roleId !== fields.roleId ? [prisma.userPermission.deleteMany({ where: { userId: id } }), update] : [update])
  const user = results.at(-1)
  clearAccessCache()
  res.json({ user: userDto(user) })
})

usersRouter.delete('/:id', async (req, res) => {
  const id = idParam(req)
  if (id === req.access.id) throw new HttpError(400, 'Vous ne pouvez pas désactiver votre propre compte.')
  const target = await prisma.user.findFirst({ where: { id, active: true } })
  if (!target) throw new HttpError(404, 'Utilisateur introuvable.')
  assertSiteScope(req.access, target.siteId)
  if (target.profile === 1) {
    if (req.access.profile !== 1) throw new HttpError(403, 'Seul un administrateur peut désactiver un compte administrateur.')
    if ((await countActiveAdmins()) <= 1) throw new HttpError(409, 'Le dernier administrateur ne peut pas être désactivé.')
  }
  await prisma.user.update({ where: { id }, data: { active: false } })
  clearAccessCache()
  res.json({ id, deleted: true })
})

/** Droits individuels : GET = rôle + ajustements + résultat ; PUT = nouvel ensemble de permissions voulu. */
async function permissionsView(targetId) {
  const target = await getUserAccess(targetId)
  if (!target) throw new HttpError(404, 'Utilisateur introuvable.')
  return {
    profile: target.profile,
    roleName: target.roleName,
    rolePermissions: [...target.basePermissions],
    granted: target.overrides.filter((row) => row.granted).map((row) => row.permission),
    revoked: target.overrides.filter((row) => !row.granted).map((row) => row.permission),
    effective: [...target.permissions],
  }
}

usersRouter.get('/:id/permissions', async (req, res) => {
  const target = await prisma.user.findUnique({ where: { id: idParam(req) }, select: { siteId: true } })
  if (!target) throw new HttpError(404, 'Utilisateur introuvable.')
  assertSiteScope(req.access, target.siteId)
  res.json(await permissionsView(req.params.id))
})

usersRouter.put('/:id/permissions', async (req, res) => {
  const id = idParam(req)
  const target = await getUserAccess(id)
  if (!target) throw new HttpError(404, 'Utilisateur introuvable.')
  assertSiteScope(req.access, target.siteId)
  if (target.profile === 1) throw new HttpError(400, 'Un administrateur a tous les droits : ils ne peuvent pas être ajustés.')
  if (id === req.access.id) throw new HttpError(400, 'Vous ne pouvez pas modifier vos propres droits.')
  const wanted = req.body?.permissions
  if (!Array.isArray(wanted) || wanted.some((permission) => !ALL_PERMISSIONS.includes(permission))) {
    throw new HttpError(400, 'La liste de permissions est invalide.')
  }
  const desired = new Set(wanted)
  const granted = [...desired].filter((permission) => !target.basePermissions.has(permission))
  const revoked = [...target.basePermissions].filter((permission) => !desired.has(permission))
  // Pas d'élévation de privilèges : on ne peut accorder que ce qu'on détient soi-même.
  if (granted.some((permission) => !req.access.permissions.has(permission))) {
    throw new HttpError(403, 'Vous ne pouvez pas accorder une permission que vous ne détenez pas.')
  }
  await prisma.$transaction([
    prisma.userPermission.deleteMany({ where: { userId: id } }),
    prisma.userPermission.createMany({
      data: [...granted.map((permission) => ({ userId: id, permission, granted: true })), ...revoked.map((permission) => ({ userId: id, permission, granted: false }))],
    }),
  ])
  clearAccessCache()
  res.json(await permissionsView(id))
})

/** Fiche d'un utilisateur (prénom, coordonnées) : GET la lit (vide si jamais renseignée), PUT la remplace. */
const PROFILE_FIELDS = { firstName: 255, email: 255, phone: 60, street: 255, street2: 255, postalCode: 30, city: 160, country: 120 }
const emptyProfile = Object.fromEntries(Object.keys(PROFILE_FIELDS).map((key) => [key, null]))

async function scopedUser(access, id) {
  const target = await prisma.user.findUnique({ where: { id }, select: { siteId: true } })
  if (!target) throw new HttpError(404, 'Utilisateur introuvable.')
  assertSiteScope(access, target.siteId)
}

usersRouter.get('/:id/profile', async (req, res) => {
  const id = idParam(req)
  await scopedUser(req.access, id)
  const profile = await prisma.userProfile.findUnique({ where: { userId: id }, select: Object.fromEntries(Object.keys(PROFILE_FIELDS).map((key) => [key, true])) })
  res.json({ profile: profile ?? emptyProfile })
})

usersRouter.put('/:id/profile', async (req, res) => {
  const id = idParam(req)
  await scopedUser(req.access, id)
  const data = {}
  for (const [key, max] of Object.entries(PROFILE_FIELDS)) {
    const value = typeof req.body?.[key] === 'string' ? req.body[key].trim() : ''
    if (value.length > max) throw new HttpError(400, `Le champ « ${key} » est trop long (${max} caractères maximum).`)
    data[key] = value || null
  }
  const profile = await prisma.userProfile.upsert({ where: { userId: id }, create: { userId: id, ...data }, update: data })
  const { userId: _userId, updatedAt: _updatedAt, ...fields } = profile
  res.json({ profile: fields })
})

// ---------------------------------------------------------------------------------- Documents d'un compte

const documentSummary = { id: true, name: true, extension: true, size: true, category: true, createdAt: true }

usersRouter.get('/:id/documents', async (req, res) => {
  const id = idParam(req)
  await scopedUser(req.access, id)
  const documents = await prisma.userDocument.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 200, select: documentSummary })
  res.json({ documents })
})

usersRouter.post('/:id/documents', express.raw({ type: () => true, limit: MAX_FILE_BYTES }), async (req, res) => {
  const id = idParam(req)
  await scopedUser(req.access, id)
  const { name, extension } = readFileName(req.headers['x-file-name'])
  const mimeType = ALLOWED_FILE_TYPES.get(extension)
  if (!name || !mimeType) throw new HttpError(400, 'Format de fichier non autorisé.')
  const category = String(req.headers['x-file-category'] || 'Autre').trim().slice(0, 80) || 'Autre'
  const content = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
  if (!content.length) throw new HttpError(400, 'Le fichier est vide.')
  const document = await prisma.userDocument.create({
    data: { userId: id, name, extension, mimeType, size: content.length, category, content, addedBy: req.access.id },
    select: documentSummary,
  })
  res.status(201).json({ document })
})

async function findDocument(req) {
  const id = idParam(req)
  await scopedUser(req.access, id)
  const documentId = req.params.documentId
  const document = UUID.test(documentId) ? await prisma.userDocument.findFirst({ where: { id: documentId, userId: id } }) : null
  if (!document) throw new HttpError(404, 'Document introuvable.')
  return document
}

usersRouter.get('/:id/documents/:documentId', async (req, res) => {
  const document = await findDocument(req)
  res
    .set({
      'Content-Type': document.mimeType,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(document.name).replaceAll("'", '%27')}`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    .send(Buffer.from(document.content))
})

usersRouter.delete('/:id/documents/:documentId', async (req, res) => {
  const document = await findDocument(req)
  await prisma.userDocument.delete({ where: { id: document.id } })
  res.json({ id: document.id, deleted: true })
})

// ---------------------------------------------------------------------------------- Photo d'identité

const MAX_PHOTO_BYTES = 2 * 1024 * 1024

usersRouter.get('/:id/photo', async (req, res) => {
  const id = idParam(req)
  await scopedUser(req.access, id)
  const photo = await prisma.userPhoto.findUnique({ where: { userId: id } })
  if (!photo) throw new HttpError(404, "Cet utilisateur n'a pas de photo.")
  res.set({ 'Content-Type': photo.mimeType, 'Cache-Control': 'private, no-cache', 'X-Content-Type-Options': 'nosniff' }).send(Buffer.from(photo.content))
})

usersRouter.put('/:id/photo', express.raw({ type: () => true, limit: MAX_PHOTO_BYTES }), async (req, res) => {
  const id = idParam(req)
  await scopedUser(req.access, id)
  const content = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
  const mimeType = detectImageType(content)
  if (!mimeType) throw new HttpError(400, 'La photo doit être une image PNG, JPEG ou WebP.')
  const data = { mimeType, content, size: content.length, updatedBy: req.access.id, updatedAt: new Date() }
  await prisma.userPhoto.upsert({ where: { userId: id }, create: { userId: id, ...data }, update: data })
  res.json({ saved: true, size: content.length })
})

usersRouter.delete('/:id/photo', async (req, res) => {
  const id = idParam(req)
  await scopedUser(req.access, id)
  await prisma.userPhoto.deleteMany({ where: { userId: id } })
  res.json({ deleted: true })
})

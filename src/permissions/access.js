import { prisma } from '../config/prisma.js'
import { ALL_PERMISSIONS, DEFAULT_PERMISSIONS_BY_PROFILE, PROFILES } from './catalog.js'

const CACHE_TTL_MS = 30_000
const cache = new Map()

/** À appeler après toute modification de rôle, de permission ou d'affectation d'utilisateur. */
export function clearAccessCache() {
  cache.clear()
}

const KNOWN = new Set(ALL_PERMISSIONS)
const known = (permissions) => permissions.filter((permission) => KNOWN.has(permission))

/** Permissions du rôle seul (sans ajustements individuels). Un administrateur a tout ; un rôle désactivé retombe sur le profil. */
function basePermissions(user) {
  if (user.profile === 1) return new Set(ALL_PERMISSIONS)
  if (user.role.active) return new Set(known(user.role.permissions.map((row) => row.permission)))
  return new Set(DEFAULT_PERMISSIONS_BY_PROFILE[user.profile] ?? [])
}

/**
 * Accès d'un compte actif : profil, site, rôle et permissions effectives (rôle + ajustements individuels).
 * Renvoie null si le compte n'existe pas ou est désactivé.
 */
export async function getUserAccess(userId) {
  const cached = cache.get(userId)
  if (cached && cached.expiresAt > Date.now()) return cached.access

  const user = await prisma.user.findFirst({
    where: { id: userId, active: true },
    include: { role: { include: { permissions: true } }, site: { select: { name: true } }, overrides: true },
  })
  if (!user) return null

  const base = basePermissions(user)
  const permissions = new Set(base)
  if (user.profile !== 1) {
    for (const override of user.overrides) {
      if (!KNOWN.has(override.permission)) continue
      if (override.granted) permissions.add(override.permission)
      else permissions.delete(override.permission)
    }
  }

  const access = {
    id: user.id,
    name: user.name,
    identifier: user.identifier,
    matricule: user.matricule,
    profile: user.profile,
    siteId: user.siteId,
    siteName: user.site?.name ?? null,
    roleId: user.roleId,
    roleName: user.role.name || PROFILES[user.profile] || 'Utilisateur',
    basePermissions: base,
    overrides: user.overrides.filter((row) => KNOWN.has(row.permission)),
    permissions,
  }
  cache.set(userId, { access, expiresAt: Date.now() + CACHE_TTL_MS })
  return access
}

/** Utilisateur tel que le voit l'interface (connexion et « /auth/me »). */
export const sessionUser = (access) => ({
  id: access.id,
  name: access.name,
  identifier: access.identifier,
  matricule: access.matricule,
  profile: access.profile,
  roleLabel: access.roleName,
  siteId: access.siteId,
  siteName: access.siteName,
  permissions: [...access.permissions].sort(),
})

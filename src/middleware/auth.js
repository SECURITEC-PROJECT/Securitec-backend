import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import { getUserAccess } from '../permissions/access.js'
import { HttpError } from './errors.js'

export const signToken = (userId) => jwt.sign({ sub: userId }, env.jwtSecret, { algorithm: 'HS256', expiresIn: '8h' })

/** Exige un jeton valide et un compte actif ; place l'accès de l'utilisateur dans `req.access`. */
export async function authenticate(req, _res, next) {
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')
  if (!match) throw new HttpError(401, 'Connectez-vous pour continuer.')
  let payload
  try {
    payload = jwt.verify(match[1], env.jwtSecret, { algorithms: ['HS256'] })
  } catch {
    throw new HttpError(401, 'Session invalide ou expirée.')
  }
  const access = typeof payload.sub === 'string' ? await getUserAccess(payload.sub) : null
  if (!access) throw new HttpError(401, 'Ce compte est désactivé ou introuvable.')
  req.access = access
  next()
}

const ACTION_BY_METHOD = { GET: 'view', HEAD: 'view', POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete' }

/**
 * Exige, sur au moins un des modules, l'action déduite de la méthode HTTP
 * (GET → view, POST → create, PUT/PATCH → update, DELETE → delete) ou `options.action`.
 */
export const requirePermission = (modules, options = {}) => (req, _res, next) => {
  const action = options.action ?? ACTION_BY_METHOD[req.method]
  const required = modules.map((module) => `${module}.${action}`)
  if (!action || !required.some((permission) => req.access.permissions.has(permission))) {
    const error = new HttpError(403, "Vous n'avez pas la permission d'effectuer cette action.")
    error.required = required
    throw error
  }
  next()
}

import { Router } from 'express'
import { requirePermission } from '../middleware/auth.js'
import { ACTIONS, PERMISSION_GROUPS, PROFILES } from '../permissions/catalog.js'

export const permissionsRouter = Router()

permissionsRouter.get('/me', (req, res) => {
  const { access } = req
  res.json({ role: { id: access.roleId, name: access.roleName, profile: access.profile }, permissions: [...access.permissions].sort() })
})

permissionsRouter.get('/catalog', requirePermission(['roles', 'users']), (_req, res) => {
  res.json({ actions: ACTIONS, groups: PERMISSION_GROUPS, profiles: PROFILES })
})

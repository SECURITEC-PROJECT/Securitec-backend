// Retire des rôles et des droits individuels les permissions qui ne figurent plus au catalogue
// (modules de l'ancien CRM jamais développés ici, par exemple). À lancer après un changement de catalogue :
//
//   node scripts/prune-permissions.js
import { prisma } from '../src/config/prisma.js'
import { ALL_PERMISSIONS } from '../src/permissions/catalog.js'

const known = { notIn: ALL_PERMISSIONS }
const roles = await prisma.rolePermission.deleteMany({ where: { permission: known } })
const overrides = await prisma.userPermission.deleteMany({ where: { permission: known } })
console.log(`${roles.count} permission(s) de rôle et ${overrides.count} droit(s) individuel(s) obsolète(s) retiré(s).`)

for (const role of await prisma.accessRole.findMany({ where: { active: true }, include: { _count: { select: { permissions: true } } }, orderBy: [{ system: 'desc' }, { baseProfile: 'asc' }] })) {
  console.log(`  ${role.name} : ${role._count.permissions} permission(s)`)
}
console.log(`Catalogue : ${ALL_PERMISSIONS.length} permissions.`)
await prisma.$disconnect()

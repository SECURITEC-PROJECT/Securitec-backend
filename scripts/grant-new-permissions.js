// À lancer après l'ajout d'un module au catalogue : donne aux rôles SYSTÈME les permissions par défaut de leur profil
// qui leur manquent pour les modules listés (ex. `node scripts/grant-new-permissions.js sheets`). Les rôles personnalisés ne sont pas touchés.
import { prisma } from '../src/config/prisma.js'
import { DEFAULT_PERMISSIONS_BY_PROFILE } from '../src/permissions/catalog.js'

const modules = process.argv.slice(2)
if (modules.length === 0) throw new Error('Indiquez au moins un module : node scripts/grant-new-permissions.js sheets')

const roles = await prisma.accessRole.findMany({ where: { system: true, active: true } })
for (const role of roles) {
  const wanted = (DEFAULT_PERMISSIONS_BY_PROFILE[role.baseProfile] ?? []).filter((permission) => modules.includes(permission.split('.')[0]))
  const { count } = await prisma.rolePermission.createMany({ data: wanted.map((permission) => ({ roleId: role.id, permission })), skipDuplicates: true })
  console.log(`Rôle « ${role.name} » : ${count} permission(s) ajoutée(s).`)
}
await prisma.$disconnect()

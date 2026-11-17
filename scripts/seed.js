// Amorçage idempotent : crée les rôles système (avec leurs permissions par défaut) et, s'il n'existe aucun
// administrateur, un premier compte administrateur.
//
//   npm run db:seed
//
// Variables facultatives (.env) : SEED_ADMIN_NAME, SEED_ADMIN_IDENTIFIER, SEED_ADMIN_MATRICULE, SEED_ADMIN_PIN (6 chiffres).
// Sans SEED_ADMIN_PIN, un PIN aléatoire est généré et affiché une seule fois.
import bcrypt from 'bcryptjs'
import { randomInt } from 'node:crypto'
import { prisma } from '../src/config/prisma.js'
import { DEFAULT_PERMISSIONS_BY_PROFILE, SYSTEM_ROLES } from '../src/permissions/catalog.js'

for (const role of SYSTEM_ROLES) {
  const permissions = [...new Set(DEFAULT_PERMISSIONS_BY_PROFILE[role.profilBase])]
  const saved = await prisma.accessRole.upsert({
    where: { code: role.code },
    // Un rôle système déjà présent garde ses permissions : un administrateur a pu les ajuster.
    update: {},
    create: { code: role.code, name: role.nom, description: role.description, baseProfile: role.profilBase, system: true },
  })
  if ((await prisma.rolePermission.count({ where: { roleId: saved.id } })) === 0) {
    await prisma.rolePermission.createMany({ data: permissions.map((permission) => ({ roleId: saved.id, permission })) })
  }
  console.log(`Rôle « ${role.nom} » : ${permissions.length} permissions par défaut.`)
}

if ((await prisma.user.count({ where: { profile: 1 } })) === 0) {
  const adminRole = await prisma.accessRole.findUniqueOrThrow({ where: { code: 'administrateur' } })
  const pin = process.env.SEED_ADMIN_PIN || String(randomInt(0, 1_000_000)).padStart(6, '0')
  if (!/^\d{6}$/.test(pin)) throw new Error('SEED_ADMIN_PIN doit contenir exactement 6 chiffres.')
  const identifier = (process.env.SEED_ADMIN_IDENTIFIER || 'admin').toLowerCase()
  await prisma.user.create({
    data: {
      name: process.env.SEED_ADMIN_NAME || 'Administrateur',
      identifier,
      matricule: process.env.SEED_ADMIN_MATRICULE || 'M0001',
      pinHash: await bcrypt.hash(pin, 12),
      profile: 1,
      roleId: adminRole.id,
    },
  })
  console.log(`\nCompte administrateur créé — identifiant : ${identifier} · PIN : ${pin}`)
  console.log('Notez ce PIN maintenant : il ne sera plus affiché. Changez-le depuis la page Utilisateurs.')
} else {
  console.log('Un administrateur existe déjà : aucun compte créé.')
}

await prisma.$disconnect()

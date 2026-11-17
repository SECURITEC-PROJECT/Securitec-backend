import bcrypt from 'bcryptjs'
import { Router } from 'express'
import { prisma } from '../config/prisma.js'
import { authenticate, signToken } from '../middleware/auth.js'
import { HttpError } from '../middleware/errors.js'
import { getUserAccess, sessionUser } from '../permissions/access.js'

export const authRouter = Router()

// Hash factice : on compare toujours un PIN pour que « identifiant inconnu » et « mauvais PIN » prennent le même temps.
const DUMMY_HASH = bcrypt.hashSync('000000', 12)

authRouter.post('/login', async (req, res) => {
  // Le champ « identifiant » accepte aussi le matricule de l'utilisateur.
  const identifier = typeof req.body?.identifier === 'string' ? req.body.identifier.trim() : ''
  const pin = typeof req.body?.pin === 'string' ? req.body.pin : ''
  if (!identifier || !pin) throw new HttpError(400, 'Identifiant (ou matricule) et PIN requis.')

  const user = await prisma.user.findFirst({
    where: { OR: [{ identifier: { equals: identifier, mode: 'insensitive' } }, { matricule: { equals: identifier, mode: 'insensitive' } }], active: true },
    select: { id: true, pinHash: true },
  })
  const valid = await bcrypt.compare(pin, user?.pinHash ?? DUMMY_HASH)
  if (!user || !valid) throw new HttpError(401, 'Identifiant, matricule ou PIN incorrect.')

  const access = await getUserAccess(user.id)
  res.json({ token: signToken(user.id), user: sessionUser(access) })
})

authRouter.get('/me', authenticate, (req, res) => {
  res.json({ user: sessionUser(req.access) })
})

/** Photo de profil du compte connecté : chacun lit la sienne, sans avoir besoin du droit de voir les utilisateurs. */
authRouter.get('/me/photo', authenticate, async (req, res) => {
  const photo = await prisma.userPhoto.findUnique({ where: { userId: req.access.id } })
  if (!photo) throw new HttpError(404, "Vous n'avez pas de photo de profil.")
  res.set({ 'Content-Type': photo.mimeType, 'Cache-Control': 'private, no-cache', 'X-Content-Type-Options': 'nosniff' }).send(Buffer.from(photo.content))
})

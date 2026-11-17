import cors from 'cors'
import express from 'express'
import { env } from './config/env.js'
import { prisma } from './config/prisma.js'
import { authenticate } from './middleware/auth.js'
import { errorHandler, notFound } from './middleware/errors.js'
import { authRouter } from './routes/auth.js'
import { minutesRouter } from './routes/minutes.js'
import { notificationsRouter } from './routes/notifications.js'
import { permissionsRouter } from './routes/permissions.js'
import { planningRouter } from './routes/planning.js'
import { postsRouter } from './routes/posts.js'
import { reportsRouter } from './routes/reports.js'
import { rolesRouter } from './routes/roles.js'
import { sheetsRouter } from './routes/sheets.js'
import { sitesRouter } from './routes/sites.js'
import { usersRouter } from './routes/users.js'

export const app = express()

app.use(cors({ origin: env.corsOrigins }))
app.use(express.json({ limit: '12mb' }))

app.get('/api/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    res.json({ api: 'ok', database: 'ok' })
  } catch {
    res.status(503).json({ api: 'ok', database: 'unavailable' })
  }
})

// Public : la connexion. Tout le reste exige une session ; chaque route déclare ensuite la permission requise.
app.use('/api/auth', authRouter)
app.use('/api', authenticate)
app.use('/api/permissions', permissionsRouter)
app.use('/api/roles', rolesRouter)
app.use('/api/reports', reportsRouter)
app.use('/api/notifications', notificationsRouter)
app.use('/api/admin/posts', postsRouter)
app.use('/api/planning', planningRouter)
app.use('/api/minutes', minutesRouter)
app.use('/api/sheets', sheetsRouter)
app.use('/api/users', usersRouter)
app.use('/api/sites', sitesRouter)
app.use(notFound)
app.use(errorHandler)

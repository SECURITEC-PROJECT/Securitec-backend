import { app } from './app.js'
import { env } from './config/env.js'

app.listen(env.port, () => console.log(`API SECURITEC démarrée sur http://localhost:${env.port}/api`))

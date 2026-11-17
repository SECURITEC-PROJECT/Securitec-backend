import { setDefaultResultOrder } from 'node:dns'
import net from 'node:net'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client.ts'
import { env } from './env.js'

// Neon répond souvent en IPv6 en premier, ce qui expire sur beaucoup de réseaux :
// on privilégie l'IPv4 et on désactive la sélection automatique qui abandonne après 250 ms.
setDefaultResultOrder('ipv4first')
net.setDefaultAutoSelectFamily(false)

// Le driver pg ne gère pas channel_binding ; sslmode=verify-full correspond au comportement actuel de « require ».
const url = new URL(env.databaseUrl)
url.searchParams.delete('channel_binding')
if (url.searchParams.get('sslmode') === 'require') url.searchParams.set('sslmode', 'verify-full')

const adapter = new PrismaPg({
  connectionString: url.toString(),
  connectionTimeoutMillis: 20000, // laisse le temps à Neon de se réveiller
  idleTimeoutMillis: 300000,
  keepAlive: true,
})

export const prisma = new PrismaClient({ adapter })

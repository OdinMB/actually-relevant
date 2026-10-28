import { PrismaClient } from '@prisma/client'
import { config } from '../config.js'

// Defaults for every interactive transaction; a call may still pass its own
const prisma = new PrismaClient({
  transactionOptions: { maxWait: config.database.transactionMaxWaitMs, timeout: config.database.transactionTimeoutMs },
})

export default prisma

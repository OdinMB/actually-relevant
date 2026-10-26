// Development seed entry: `npm run db:seed`, and Prisma's `migrations.seed` (prisma.config.ts).
// The writes live in seedDatabase.ts, so the db tests can run them without this file's side effects.
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { seedDatabase } from './seedDatabase.js'

const prisma = new PrismaClient()

seedDatabase(prisma)
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

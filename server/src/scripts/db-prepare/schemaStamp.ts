/**
 * Tells whether the Prisma client must be regenerated. Prisma 6 writes a
 * reformatted copy of the schema into the generated client, so that copy cannot
 * be compared with prisma/schema.prisma; instead db:prepare stores a hash of the
 * source schema next to the client after each successful generate.
 */
import { createHash } from 'node:crypto'

export function schemaHash(schema: string): string {
  return createHash('sha256').update(schema.replace(/\r\n/g, '\n')).digest('hex')
}

export function needsGenerate(input: { schema: string; stamp: string | null; clientPresent: boolean }): boolean {
  if (!input.clientPresent || input.stamp === null) return true
  return input.stamp.trim() !== schemaHash(input.schema)
}

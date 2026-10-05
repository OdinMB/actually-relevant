/**
 * Reads Prisma CLI output, so db:prepare can print one short line instead of
 * the full transcript and name the likely cause when a command fails.
 */

export type GenerateFailure = 'locked' | 'other'
export type MigrateFailure = 'unreachable' | 'failed-migration' | 'other'

export function classifyGenerateFailure(output: string): GenerateFailure {
  return /\bEPERM\b|\bEBUSY\b|operation not permitted|resource busy or locked/i.test(output) ? 'locked' : 'other'
}

export function classifyMigrateFailure(output: string): MigrateFailure {
  if (/\bP1001\b/.test(output)) return 'unreachable'
  if (/\bP3009\b|\bP3018\b/.test(output)) return 'failed-migration'
  return 'other'
}

export function summarizeMigrateSuccess(output: string): { applied: string[] } {
  const applied = [...output.matchAll(/Applying migration `([^`]+)`/g)].map((match) => match[1])
  return { applied }
}

import { readFileSync } from 'fs'
import { z } from 'zod'

/**
 * What an overview's title and charter may hold, from shared/overviewCharterLimits.json: the one list
 * the admin's forms read too, so the server's checks and the forms cannot drift
 * (`.context/overviews.md`, "Charter limits"). The server's tsconfig cannot import files outside
 * `src/`, so it reads the file at startup, as `staticRoutes.ts` does; the path is the same from
 * `src/lib/` and `dist/lib/`, and a missing or malformed file stops the server at boot.
 */
export const CHARTER_LIMITS_FILE = new URL('../../../shared/overviewCharterLimits.json', import.meta.url)

const whole = z.number().int().positive()
const limitsSchema = z.object({ titleChars: whole, inChars: whole, outEntries: whole, outChars: whole, endEventChars: whole })

export type CharterLimits = z.infer<typeof limitsSchema>

export function loadCharterLimits(file: URL | string = CHARTER_LIMITS_FILE): CharterLimits {
  return limitsSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
}

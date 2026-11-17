/** UTC calendar days as `YYYY-MM-DD` strings, and back. Pure. */

/** The UTC day of `date`: `2026-11-14`. */
export const utcDay = (date: Date): string => date.toISOString().slice(0, 10)

/** The start of a `YYYY-MM-DD` day, UTC. */
export const dayStart = (day: string): Date => new Date(`${day}T00:00:00Z`)

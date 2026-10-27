import { describe, it, expect } from 'vitest'
import { THIS_WEEK_MAX_AGE_MS, thisWeekIssuePath } from './this-week-issue'

const NOW = Date.parse('2026-10-25T08:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const issue = (slug: string, ageMs: number) => ({ slug, publishedAt: new Date(NOW - ageMs).toISOString() })

describe('thisWeekIssuePath', () => {
  it("leads to the newest issue's web edition, the archive's first", () => {
    expect(thisWeekIssuePath([issue('week-43-2026', DAY), issue('week-42-2026', 8 * DAY)], NOW)).toBe('/newsletter/week-43-2026')
  })

  it('is null while no issue is known: none published, or the archive not loaded', () => {
    expect(thisWeekIssuePath([], NOW)).toBeNull()
    expect(thisWeekIssuePath(undefined, NOW)).toBeNull()
  })

  it('keeps the newest issue for a week and a day after it was published, then lets it go', () => {
    expect(THIS_WEEK_MAX_AGE_MS).toBe(8 * DAY)
    expect(thisWeekIssuePath([issue('week-42-2026', 8 * DAY)], NOW)).toBe('/newsletter/week-42-2026')
    expect(thisWeekIssuePath([issue('week-42-2026', 8 * DAY + 1)], NOW)).toBeNull()
  })

  it("counts an issue dated a little ahead of the reader's clock as this week's", () => {
    expect(thisWeekIssuePath([issue('week-43-2026', -60 * 1000)], NOW)).toBe('/newsletter/week-43-2026')
  })

  it('is null for an issue whose date cannot be read', () => {
    expect(thisWeekIssuePath([{ slug: 'week-43-2026', publishedAt: 'not a date' }], NOW)).toBeNull()
  })
})

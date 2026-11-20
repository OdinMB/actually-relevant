import { describe, expect, it } from 'vitest'
import { anchorHolds, anchorOf, automatedRecenterBlocked, recenterLockedUntil, type AnchorEntry, type RecenterState } from './overviewRecenter.js'

const day = (d: number) => new Date(Date.UTC(2026, 9, d, 8))
const OPTIONS = { anchorTurningShare: 2 / 3, anchorStandIns: 2, maxAutomatedRecenters: 2, editorRecenterLockDays: 180 }

const entry = (i: number, over: Partial<AnchorEntry> = {}): AnchorEntry => ({
  entryId: `e${i}`,
  status: 'active',
  published: true,
  datePublished: day(i),
  role: 'routine',
  ...over,
})
const turning = (i: number, over: Partial<AnchorEntry> = {}) => entry(i, { role: 'turning_point', ...over })

describe('anchorOf', () => {
  it('takes the founding entries still active and published, oldest first, then the other turning points', () => {
    const anchor = anchorOf([entry(5), turning(2), entry(1), turning(4), turning(3)], ['e1', 'e2'], OPTIONS)
    expect(anchor).toEqual({ founding: ['e1', 'e2'], standIns: false, turningPoints: ['e3', 'e4'] })
  })

  it('leaves out a founding entry detached or unpublished, and a turning point detached', () => {
    const anchor = anchorOf(
      [entry(1, { status: 'detached' }), entry(2), entry(3, { published: false }), turning(4), turning(5, { status: 'detached' })],
      ['e1', 'e2', 'e3'],
      OPTIONS,
    )
    expect(anchor).toEqual({ founding: ['e2'], standIns: false, turningPoints: ['e4'] })
  })

  it('stands the 2 oldest active entries in for the founding ones when none is left', () => {
    const anchor = anchorOf([entry(1, { status: 'detached' }), turning(6), entry(4), entry(3), turning(5)], ['e1', 'e2'], OPTIONS)
    expect(anchor).toEqual({ founding: ['e3', 'e4'], standIns: true, turningPoints: ['e5', 'e6'] })
  })
})

describe('anchorHolds', () => {
  const anchor = (turningPoints: number) => ({
    founding: ['f1', 'f2'],
    standIns: false,
    turningPoints: Array.from({ length: turningPoints }, (_, i) => `t${i + 1}`),
  })
  const failing =
    (...ids: string[]) =>
    (id: string) =>
      !ids.includes(id)

  it('needs every founding entry judged to belong', () => {
    expect(anchorHolds(anchor(0), failing(), OPTIONS)).toEqual({ holds: true, failed: [] })
    expect(anchorHolds(anchor(3), failing('f2'), OPTIONS)).toEqual({ holds: false, failed: ['f2'] })
  })

  it('needs 2/3 of the turning points, rounded up: 3 of 4, 2 of 3, all of 1 or 2', () => {
    expect(anchorHolds(anchor(4), failing('t1'), OPTIONS)).toEqual({ holds: true, failed: ['t1'] })
    expect(anchorHolds(anchor(4), failing('t1', 't2'), OPTIONS).holds).toBe(false)
    expect(anchorHolds(anchor(3), failing('t3'), OPTIONS).holds).toBe(true)
    expect(anchorHolds(anchor(3), failing('t1', 't3'), OPTIONS)).toEqual({ holds: false, failed: ['t1', 't3'] })
    expect(anchorHolds(anchor(2), failing('t2'), OPTIONS).holds).toBe(false)
    expect(anchorHolds(anchor(1), failing('t1'), OPTIONS).holds).toBe(false)
    expect(anchorHolds(anchor(1), failing(), OPTIONS).holds).toBe(true)
  })
})

describe('the fixed limits on an automated re-center', () => {
  const NOW = day(20)
  const state = (over: Partial<RecenterState> = {}): RecenterState => ({
    scope: 'ongoing',
    status: 'open',
    frozen: false,
    automatedRecenters: 0,
    recenteredAt: null,
    recenteredBy: null,
    ...over,
  })

  it('allows an ongoing open or quiet overview under the limit', () => {
    expect(automatedRecenterBlocked(state(), NOW, OPTIONS)).toBeNull()
    expect(automatedRecenterBlocked(state({ status: 'quiet', automatedRecenters: 1 }), NOW, OPTIONS)).toBeNull()
  })

  it('skips a frozen, closing, closed, forming or single overview', () => {
    expect(automatedRecenterBlocked(state({ frozen: true }), NOW, OPTIONS)).toBe('frozen')
    expect(automatedRecenterBlocked(state({ status: 'closing' }), NOW, OPTIONS)).toBe('status')
    expect(automatedRecenterBlocked(state({ status: 'closed' }), NOW, OPTIONS)).toBe('status')
    expect(automatedRecenterBlocked(state({ scope: 'forming' }), NOW, OPTIONS)).toBe('scope')
    expect(automatedRecenterBlocked(state({ scope: 'single' }), NOW, OPTIONS)).toBe('scope')
  })

  it('leaves an overview at 2 applied automated re-centers to an editor', () => {
    expect(automatedRecenterBlocked(state({ automatedRecenters: 2 }), NOW, OPTIONS)).toBe('limit')
  })

  it("holds automation off for 180 days after an editor's or an Undo's re-center, never after its own", () => {
    const at = (by: string, daysAgo: number) => state({ recenteredBy: by, recenteredAt: new Date(NOW.getTime() - daysAgo * 86_400_000) })
    expect(automatedRecenterBlocked(at('editor', 10), NOW, OPTIONS)).toBe('locked')
    expect(automatedRecenterBlocked(at('undo', 179), NOW, OPTIONS)).toBe('locked')
    expect(automatedRecenterBlocked(at('editor', 180), NOW, OPTIONS)).toBeNull()
    expect(automatedRecenterBlocked(at('recenter', 1), NOW, OPTIONS)).toBeNull()
    expect(recenterLockedUntil(at('editor', 10), OPTIONS)).toEqual(new Date(NOW.getTime() + 170 * 86_400_000))
    expect(recenterLockedUntil(at('recenter', 10), OPTIONS)).toBeNull()
  })
})

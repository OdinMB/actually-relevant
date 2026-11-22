import { describe, expect, it, vi } from 'vitest'

// Nothing here reads the database: the client is stood in for only so the module loads without one
const mockPrisma = vi.hoisted(() => ({}))
vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))

const { lastChangeOf } = await import('./overviewPublic.js')

const day = (d: number) => new Date(Date.UTC(2026, 0, d, 8))
const closed = (closedReason: string, closedAt: Date) => ({ status: 'closed' as const, closedReason, closedAt, foundedAt: day(1), lastEntryAt: day(10) })

describe('lastChangeOf', () => {
  it('dates a faded overview by its last story or its stands, never the day it faded', () => {
    const faded = closed('faded', day(130))
    expect(lastChangeOf(faded, day(12))).toEqual(day(12))
    expect(lastChangeOf(faded, null)).toEqual(day(10))
  })

  it('dates an overview an editor closed by its Close when that came last', () => {
    expect(lastChangeOf(closed('editor', day(15)), day(12))).toEqual(day(15))
  })
})

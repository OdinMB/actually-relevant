import { describe, it, expect } from 'vitest'
import { parsePublishedDate } from './publishedDate.js'

describe('parsePublishedDate', () => {
  it.each([
    ['2024-01-15T00:00:00Z', '2024-01-15T00:00:00.000Z'],
    ['2024-01-15', '2024-01-15T00:00:00.000Z'],
    ['Mon, 15 Jan 2024 00:00:00 GMT', '2024-01-15T00:00:00.000Z'],
    ['Mon, 15 Jan 2024 00:00:00 +0100', '2024-01-14T23:00:00.000Z'],
    ['Mon, 15 Jan 2024 00:00:00 EST', '2024-01-15T05:00:00.000Z'],
  ])('reads %s', (raw, iso) => {
    expect(parsePublishedDate(raw)).toBe(iso)
  })

  // SIPRI's feed writes "19 Nov 2026 10:07:08 CET"; JavaScript's Date knows only the US zone names
  it.each([
    ['19 Nov 2026 10:07:08 CET', '2026-11-19T09:07:08.000Z'],
    ['Thu, 18 Jun 2026 14:00:00 CEST', '2026-06-18T12:00:00.000Z'],
    ['18 Jun 2026 14:00:00 BST', '2026-06-18T13:00:00.000Z'],
    ['18 Jun 2026 14:00:00 AEST', '2026-06-18T04:00:00.000Z'],
    ['18 Jun 2026 14:00:00 cet', '2026-06-18T13:00:00.000Z'],
  ])('reads %s, a European or other zone name', (raw, iso) => {
    expect(parsePublishedDate(raw)).toBe(iso)
  })

  it.each([[null], [undefined], [''], ['   '], ['not a date'], ['19 Nov 2026 10:07:08 XYZT'], ['Invalid Date']])('gives null for %s', raw => {
    expect(parsePublishedDate(raw)).toBeNull()
  })
})

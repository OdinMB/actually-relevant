import { describe, it, expect } from 'vitest'
import { isTdmReserved, pageTdmReservation, parseTdmRep } from './tdmRep.js'

describe('parseTdmRep and isTdmReserved', () => {
  it('reserves a path a reserving entry matches, and only that path', () => {
    const rules = parseTdmRep(JSON.stringify([{ location: '/news/*', 'tdm-reservation': 1, 'tdm-policy': 'https://example.com/policy.json' }]))
    expect(isTdmReserved(rules, '/news/story')).toBe(true)
    expect(isTdmReserved(rules, '/blog/post')).toBe(false)
  })

  it('does not reserve on an entry with tdm-reservation 0', () => {
    const rules = parseTdmRep(JSON.stringify([{ location: '/', 'tdm-reservation': 0 }]))
    expect(isTdmReserved(rules, '/news/story')).toBe(false)
  })

  it('reserves when any matching entry reserves, whatever its place in the file', () => {
    const rules = parseTdmRep(
      JSON.stringify([
        { location: '/open/*', 'tdm-reservation': 0 },
        { location: '/*', 'tdm-reservation': '1' },
      ]),
    )
    expect(isTdmReserved(rules, '/open/story')).toBe(true)
  })

  it('treats invalid JSON, a non-array and malformed entries as no reservation', () => {
    expect(parseTdmRep('<html>Not found</html>')).toEqual([])
    expect(parseTdmRep('')).toEqual([])
    expect(parseTdmRep(JSON.stringify({ location: '/', 'tdm-reservation': 1 }))).toEqual([])
    expect(isTdmReserved(parseTdmRep(JSON.stringify([null, 'x', { 'tdm-reservation': 1 }, { location: 5, 'tdm-reservation': 1 }])), '/a')).toBe(false)
  })
})

describe('pageTdmReservation', () => {
  it('finds the tdm-reservation response header', () => {
    expect(pageTdmReservation('1', '<html></html>')).toMatch(/header/)
    expect(pageTdmReservation(' 1 ', '<html></html>')).toMatch(/header/)
    expect(pageTdmReservation('0', '<html></html>')).toBeNull()
  })

  it('finds the tdm-reservation meta tag in any attribute order or quoting', () => {
    expect(pageTdmReservation(undefined, '<head><meta name="tdm-reservation" content="1"></head>')).toMatch(/meta/)
    expect(pageTdmReservation(undefined, "<head><META content='1' NAME='TDM-Reservation' /></head>")).toMatch(/meta/)
    expect(pageTdmReservation(undefined, '<head><meta name=tdm-reservation content=1></head>')).toMatch(/meta/)
  })

  it('finds nothing on a page without a reserving marker', () => {
    expect(pageTdmReservation(undefined, '<head><meta name="tdm-reservation" content="0"><meta name="description" content="1"></head>')).toBeNull()
    expect(pageTdmReservation(undefined, '<p>tdm-reservation 1</p>')).toBeNull()
  })
})

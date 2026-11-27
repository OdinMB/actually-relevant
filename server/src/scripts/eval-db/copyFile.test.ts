import { describe, it, expect } from 'vitest'
import { CopyFileError, CopyReader, headerLine, rowLine, splitLines, trailerLine } from './copyFile.js'

const TABLES = ['issues', 'feeds', 'stories']
const WINDOW = { months: 6, since: '2026-05-26T12:00:00.000Z' }
const HEADER = headerLine({ exportedAt: '2026-11-26T12:00:00.000Z', migration: '20261120000620_overview_recenter', window: WINDOW })

const read = (lines: string[]) => {
  const reader = new CopyReader(TABLES)
  const rows = lines.flatMap(line => {
    const entry = reader.read(line)
    return entry ? [entry] : []
  })
  return { rows, counts: reader.finish(), header: reader.header }
}

describe('the copy file', () => {
  it('reads back the rows it wrote, in order, with the header and the counts', () => {
    const lines = [
      HEADER,
      rowLine('issues', { id: 'i1', parent_id: null }),
      rowLine('issues', { id: 'i2', parent_id: 'i1' }),
      rowLine('stories', { id: 's1', title: 'Line\nbreak' }),
      trailerLine({ issues: 2, stories: 1 }),
    ]
    expect(lines.every(l => !l.includes('\n'))).toBe(true)
    const { rows, counts, header } = read(lines)
    expect(rows).toEqual([
      { table: 'issues', row: { id: 'i1', parent_id: null } },
      { table: 'issues', row: { id: 'i2', parent_id: 'i1' } },
      { table: 'stories', row: { id: 's1', title: 'Line\nbreak' } },
    ])
    expect(counts).toEqual({ issues: 2, stories: 1 })
    expect(header).toMatchObject({ exportedAt: '2026-11-26T12:00:00.000Z', migration: '20261120000620_overview_recenter', window: WINDOW })
  })

  it("reads the header's window: the months and their cutoff, every story, or every story for a copy made before the window existed", () => {
    const all = headerLine({ exportedAt: '2026-11-26T12:00:00.000Z', migration: null, window: 'all' })
    expect(read([all, trailerLine({})]).header?.window).toBe('all')
    const older = JSON.stringify({ format: 'actually-relevant-eval-copy', version: 1, exportedAt: '2026-11-26T12:00:00.000Z', migration: null })
    expect(read([older, trailerLine({})]).header?.window).toBe('all')
  })

  it.each([
    ['a word', 'six'],
    ['months that are not a whole number', { months: 1.5, since: '2026-05-26T12:00:00.000Z' }],
    ['no cutoff', { months: 6 }],
    ['a cutoff that is not a date', { months: 6, since: 'soon' }],
  ])('refuses a window of %s', (_label, window) => {
    const header = JSON.stringify({ format: 'actually-relevant-eval-copy', version: 1, exportedAt: '2026-11-26T12:00:00.000Z', migration: null, window })
    expect(() => read([header, trailerLine({})])).toThrow(/window/)
  })

  it.each([
    ['no header', [rowLine('issues', { id: 'i1' })], /header/],
    ['another format', [JSON.stringify({ format: 'something-else', version: 1 })], /header/],
    ['a later version', [HEADER.replace('"version":1', '"version":2')], /version/],
    ['a table off the list', [HEADER, rowLine('users', { id: 'u1', email: 'odin@example.org' })], /users.*not one the copy may hold/],
    ['a table out of order', [HEADER, rowLine('stories', { id: 's1' }), rowLine('issues', { id: 'i1' })], /out of order/],
    ['a table that comes back', [HEADER, rowLine('issues', { id: 'i1' }), rowLine('feeds', { id: 'f1' }), rowLine('issues', { id: 'i2' })], /out of order/],
    ['a line after the end', [HEADER, trailerLine({}), rowLine('issues', { id: 'i1' })], /after its end/],
    ['a line that is not JSON', [HEADER, '{"table":"issues","row":'], /line 2/],
    ['a row that is not an object', [HEADER, JSON.stringify({ table: 'issues', row: ['i1'] })], /line 2/],
  ])('refuses %s', (_label, lines, message) => {
    expect(() => read(lines)).toThrow(CopyFileError)
    expect(() => read(lines)).toThrow(message)
  })

  it('refuses a copy cut short or whose counts differ from its rows', () => {
    expect(() => read([HEADER, rowLine('issues', { id: 'i1' })])).toThrow(/cut short/)
    expect(() => read([])).toThrow(/cut short/)
    expect(() => read([HEADER, rowLine('issues', { id: 'i1' }), trailerLine({ issues: 2 })])).toThrow(/issues: 1 rows, its end says 2/)
    expect(() => read([HEADER, trailerLine({ feeds: 1 })])).toThrow(/feeds: 0 rows, its end says 1/)
  })
})

async function* chunks(...parts: Buffer[]) {
  for (const p of parts) yield p
}

describe('splitLines', () => {
  it('splits on newlines across chunk boundaries, a character split between chunks included', async () => {
    const text = Buffer.from('first\nsec€nd\nthird')
    const euro = text.indexOf('€') + 1 // inside the three bytes of €
    const lines: string[] = []
    for await (const line of splitLines(chunks(text.subarray(0, 3), text.subarray(3, euro), text.subarray(euro)))) lines.push(line)
    expect(lines).toEqual(['first', 'sec€nd', 'third'])
  })

  it('yields no empty last line after a final newline', async () => {
    const lines: string[] = []
    for await (const line of splitLines(chunks(Buffer.from('a\nb\n')))) lines.push(line)
    expect(lines).toEqual(['a', 'b'])
  })
})

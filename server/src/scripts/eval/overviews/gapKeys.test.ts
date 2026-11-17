/**
 * Committed gap keys can't rot: every `gapKeys/*.json` passes the schema and `validateGapKey`, with
 * no database (the slugs, dates, research runs and quotes against the database are the `gap-keys`
 * step's). Each rule's failure is shown on a small inline key.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CONTEXT_SLOTS } from '../../../schemas/storyContext.js'
import { parseGapKey, validateGapKey, type GapKey } from './gapKeySchema.js'
import { GAP_KEYS_DIR, readGapKeyFiles } from './keyFiles.js'

describe('the committed gap keys', () => {
  it('each pass the schema and validateGapKey (none committed until they are drafted and checked)', () => {
    expect(readGapKeyFiles(GAP_KEYS_DIR).filter(f => f.errors.length > 0)).toEqual([])
  })
})

const need = (id: string, slot: string, extra: Record<string, unknown> = {}) => ({
  id,
  slot,
  need: `What a reader needs for ${slot}`,
  kind: 'figure',
  importance: 'must',
  inStory: null,
  accepts: `Any figure for ${slot}, credited to a named source`,
  example: { value: '2.6 million hectares', source: 'The Guardian' },
  ...extra,
})

/** A key that keeps every rule: two needs, the other slots not needed. */
function key(): Record<string, unknown> & { needs: Record<string, unknown>[]; notNeeded: Record<string, unknown>[] } {
  return {
    schemaVersion: 1,
    slug: 'indonesia-s-fires-burn-nearly-3-million-hectares',
    title: "Indonesia's 2026 fires may set a century record",
    date: '2026-11-14',
    needs: [need('record-2015', 'compared'), need('response-under-way', 'response', { kind: 'fact', example: null })],
    notNeeded: CONTEXT_SLOTS.filter(s => s !== 'compared' && s !== 'response').map(slot => ({ slot, why: 'The story needs none' })),
    notes: '',
  }
}

const errorsOf = (json: unknown) => parseGapKey(json).errors

describe('validateGapKey', () => {
  it('passes a key that keeps every rule', () => {
    expect(errorsOf(key())).toEqual([])
  })

  it('checks the date and the slots against the schema', () => {
    expect(errorsOf({ ...key(), date: '14 Nov 2026' }).join()).toMatch(/date/)
    expect(errorsOf({ ...key(), date: '2026-02-30' }).join()).toMatch(/2026-02-30/)
    const k = key()
    k.needs[0] = need('x', 'background')
    expect(errorsOf(k).join()).toMatch(/slot/)
  })

  it('wants 2 to 8 needs with unique ids and at least one must', () => {
    const one = key()
    one.needs = [one.needs[1]!]
    one.notNeeded.push({ slot: 'compared', why: 'none' })
    expect(errorsOf(one).join()).toMatch(/1 needs/)
    const many = key()
    many.needs.push(...Array.from({ length: 7 }, (_, i) => need(`more-${i}`, 'compared')))
    expect(errorsOf(many).join()).toMatch(/9 needs/)
    const twice = key()
    twice.needs[0] = need('response-under-way', 'compared')
    expect(errorsOf(twice).join()).toMatch(/response-under-way.*twice/)
  })

  it('wants the response need, as a must (D10)', () => {
    const without = key()
    without.needs[1] = need('why', 'why_now')
    without.notNeeded = [...without.notNeeded.filter(n => n.slot !== 'why_now'), { slot: 'response', why: 'none' }]
    expect(errorsOf(without).join()).toMatch(/response.*must/)
    const nice = key()
    nice.needs[1] = need('response-under-way', 'response', { importance: 'nice' })
    expect(errorsOf(nice).join()).toMatch(/response.*must/)
  })

  it('takes a non-empty inStory quote only', () => {
    const k = key()
    k.needs[0] = need('record-2015', 'compared', { inStory: '  ' })
    expect(errorsOf(k).join()).toMatch(/inStory/)
    k.needs[0] = need('record-2015', 'compared', { inStory: 'the 2015 record' })
    expect(errorsOf(k)).toEqual([])
  })

  it('wants every slot either needed or not needed once, never both', () => {
    const missing = key()
    missing.notNeeded = missing.notNeeded.filter(n => n.slot !== 'key_term')
    expect(errorsOf(missing).join()).toMatch(/key_term.*neither/)
    const both = key()
    both.notNeeded.push({ slot: 'compared', why: 'none' })
    expect(errorsOf(both).join()).toMatch(/compared.*both/)
    const twice = key()
    twice.notNeeded.push({ slot: 'key_term', why: 'again' })
    expect(errorsOf(twice).join()).toMatch(/key_term.*twice/)
  })

  it('returns the parsed key with its defaults', () => {
    const { notes: _notes, ...rest } = key()
    const parsed = parseGapKey(rest).key as GapKey
    expect(parsed.notes).toBe('')
    expect(validateGapKey(parsed)).toEqual([])
  })
})

describe('reading the gap-key files', () => {
  let dir = ''
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = ''
  })

  it('reads none from a folder not there yet', () => {
    expect(readGapKeyFiles(join(tmpdir(), 'no-gap-keys-here'))).toEqual([])
  })

  it('names a file after its slug, and reports broken JSON', () => {
    dir = mkdtempSync(join(tmpdir(), 'gap-keys-'))
    writeFileSync(join(dir, 'other.json'), JSON.stringify(key()))
    writeFileSync(join(dir, 'broken.json'), '{')
    writeFileSync(join(dir, 'notes.txt'), 'ignored')
    const files = readGapKeyFiles(dir)
    expect(files.map(f => f.file)).toEqual(['broken.json', 'other.json'])
    expect(files[0]!.errors.join()).toMatch(/not valid JSON/)
    expect(files[1]!.errors.join()).toMatch(/named other.json.*indonesia/)
  })
})

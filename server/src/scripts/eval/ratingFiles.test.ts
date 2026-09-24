import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { KEY_FILE, SETS_FILE, replaceRatingSetFiles, writeRatingDeliverable } from './ratingFiles.js'
import type { RatingSetsFile } from './ratingSets.js'
import type { RatingItemDraft, RatingSetSlug } from './types.js'

const draft = (set: RatingSetSlug, key: string, context = `Context ${key}`): RatingItemDraft => ({
  set, key, context_md: context, tags: {},
  options: [{ arm: 'gpt-5-mini@medium', content_md: `base ${key}` }, { arm: 'gpt-6-luna@medium', content_md: `cand ${key}` }],
})
const many = (set: RatingSetSlug, n: number, prefix: string = set) => Array.from({ length: n }, (_, i) => draft(set, `${prefix}-${i}`))
const socialPosts = many('social-post', 2).map((d, i) => ({ ...d, tags: { platform: i === 0 ? 'bluesky' : 'mastodon' } }))
const phase1Drafts = [...many('full-assessment', 3), ...socialPosts, ...many('newsletter-intro', 2), ...many('podcast-script', 1)]

const dirs: string[] = []
const tempOut = () => {
  const dir = mkdtempSync(join(tmpdir(), 'eval-rating-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})
const read = (out: string, name: string) => readFileSync(join(out, name), 'utf8')

describe('writeRatingDeliverable', () => {
  it('writes and validates a deliverable when none exists', () => {
    const out = tempOut()
    const summary = writeRatingDeliverable(out, phase1Drafts)
    expect(summary.written).toBe(true)
    expect(summary.validationErrors).toEqual([])
    expect((JSON.parse(read(out, SETS_FILE)) as RatingSetsFile).sets).toHaveLength(4)
  })

  it('never overwrites an existing deliverable the owner may be rating from', () => {
    const out = tempOut()
    writeFileSync(join(out, SETS_FILE), 'owner copy')
    writeFileSync(join(out, KEY_FILE), 'owner key')
    const summary = writeRatingDeliverable(out, phase1Drafts)
    expect(summary.written).toBe(false)
    expect(summary.sets.map(s => s.items)).toEqual([3, 2, 2, 1])
    expect(read(out, SETS_FILE)).toBe('owner copy')
    expect(read(out, KEY_FILE)).toBe('owner key')
  })
})

describe('replaceRatingSetFiles', () => {
  const others = (text: string) => {
    const file = JSON.parse(text) as RatingSetsFile
    return JSON.stringify(file.sets.filter(s => !s.id.includes('full-assessment')), null, 2)
  }

  it('swaps in the new version and leaves every other set exactly as it was', () => {
    const out = tempOut()
    writeRatingDeliverable(out, phase1Drafts)
    const before = read(out, SETS_FILE)
    const result = replaceRatingSetFiles(out, 'full-assessment', 2, many('full-assessment', 4, 'recal'))
    expect(result.set).toEqual({ id: 'actually-relevant-full-assessment-v2', items: 4 })
    expect(result.validationErrors).toEqual([])
    const after = read(out, SETS_FILE)
    expect(others(after)).toBe(others(before))
    expect(after).not.toContain('actually-relevant-full-assessment-01')
    expect(Object.keys(JSON.parse(read(out, KEY_FILE)) as object).filter(id => id.includes('full-assessment'))).toEqual([
      'actually-relevant-full-assessment-v2-01', 'actually-relevant-full-assessment-v2-02',
      'actually-relevant-full-assessment-v2-03', 'actually-relevant-full-assessment-v2-04',
    ])
  })

  it('refuses to rewrite files not in the harness format, leaving them untouched', () => {
    const out = tempOut()
    writeRatingDeliverable(out, phase1Drafts)
    const compact = JSON.stringify(JSON.parse(read(out, SETS_FILE)))
    writeFileSync(join(out, SETS_FILE), compact)
    expect(() => replaceRatingSetFiles(out, 'full-assessment', 2, many('full-assessment', 4, 'recal'))).toThrow(/format/)
    expect(read(out, SETS_FILE)).toBe(compact)
  })

  it('refuses when no new item survives blinding, keeping the old set', () => {
    const out = tempOut()
    writeRatingDeliverable(out, phase1Drafts)
    const before = read(out, SETS_FILE)
    expect(() => replaceRatingSetFiles(out, 'full-assessment', 2, [draft('full-assessment', 'x', 'An OpenAI story')])).toThrow(/blinding/)
    expect(read(out, SETS_FILE)).toBe(before)
  })
})

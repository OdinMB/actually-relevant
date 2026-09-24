import { describe, it, expect } from 'vitest'
import { buildRatingDeliverable, validateRatingDeliverable, RATING_BUDGET, type RatingSetsFile } from './ratingSets.js'
import type { RatingItemDraft, RatingSetSlug } from './types.js'

const BASE = 'gpt-5-mini@medium'
const CAND = 'gpt-6-luna@medium'

function draft(set: RatingSetSlug, key: string, tags: RatingItemDraft['tags'] = {}, content = ['Option one text', 'Option two text'], context = 'Context'): RatingItemDraft {
  return { set, key, context_md: context, options: [{ arm: BASE, content_md: content[0] }, { arm: CAND, content_md: content[1] }], tags }
}

const many = (set: RatingSetSlug, n: number, tags: (i: number) => RatingItemDraft['tags'] = () => ({})) =>
  Array.from({ length: n }, (_, i) => draft(set, `${set}-${i}`, tags(i)))

describe('buildRatingDeliverable', () => {
  it('produces exactly the specified keys at every level', () => {
    const { sets } = buildRatingDeliverable(many('podcast-script', 1))
    expect(Object.keys(sets).sort()).toEqual(['project', 'sets'])
    expect(Object.keys(sets.sets[0]).sort()).toEqual(['id', 'instructions', 'items', 'title'])
    expect(Object.keys(sets.sets[0].items[0]).sort()).toEqual(['context_md', 'id', 'options'])
    expect(Object.keys(sets.sets[0].items[0].options[0]).sort()).toEqual(['content_md', 'label', 'type'])
  })

  it('numbers items as <set id>-NN', () => {
    const { sets } = buildRatingDeliverable(many('newsletter-intro', 3))
    expect(sets.sets[0].items.map(i => i.id)).toEqual([
      'actually-relevant-newsletter-intro-01', 'actually-relevant-newsletter-intro-02', 'actually-relevant-newsletter-intro-03',
    ])
  })

  it('enforces per-set caps', () => {
    const { sets } = buildRatingDeliverable([
      ...many('full-assessment', 30),
      ...many('newsletter-intro', 9),
      ...many('social-post', 30, i => ({ platform: i % 2 ? 'bluesky' : 'mastodon' })),
    ])
    for (const set of sets.sets) {
      const slug = set.id.replace('actually-relevant-', '') as RatingSetSlug
      expect(set.items.length).toBeLessThanOrEqual(RATING_BUDGET[slug])
      for (const item of set.items) expect(item.options.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('assigns labels deterministically, with both arms appearing as A', () => {
    const drafts = many('full-assessment', 12)
    const first = buildRatingDeliverable(drafts)
    expect(buildRatingDeliverable(drafts).key).toEqual(first.key)
    const aArms = new Set(Object.values(first.key).map(k => k.A))
    expect(aArms).toEqual(new Set([BASE, CAND]))
  })

  it('maps labels to arm keys in the answer key', () => {
    const { sets, key } = buildRatingDeliverable([draft('podcast-script', 'p', {}, ['base script', 'cand script'])])
    const item = sets.sets[0].items[0]
    for (const option of item.options) {
      expect(key[item.id][option.label]).toBe(option.content_md === 'base script' ? BASE : CAND)
    }
  })

  it('excludes an item whose option names a model', () => {
    const leaky = draft('newsletter-intro', 'leak', {}, ['As a GPT-6 Luna model, I think', 'Fine text'])
    const { sets, excluded } = buildRatingDeliverable([leaky, draft('newsletter-intro', 'ok')])
    expect(excluded).toEqual([{ set: 'newsletter-intro', key: 'leak', where: 'option', terms: ['Luna', 'gpt'] }])
    expect(sets.sets[0].items).toHaveLength(1)
  })

  it('excludes an item whose story mentions a model name, even when the options do not (owner rule)', () => {
    const story = draft('full-assessment', 'ai-story', {}, ['Analysis one', 'Analysis two'], 'OpenAI released GPT-6 this week.')
    const { sets, key, excluded } = buildRatingDeliverable([story, draft('full-assessment', 'ok')])
    expect(excluded).toEqual([{ set: 'full-assessment', key: 'ai-story', where: 'context', terms: ['gpt', 'OpenAI'] }])
    expect(sets.sets[0].items.map(i => i.context_md)).toEqual(['Context'])
    expect(Object.keys(key)).toHaveLength(1)
  })

  it('takes only differing selection groups, most different first, fewer than 5 when fewer differ', () => {
    const drafts = [
      draft('story-selection', 'same', { jaccard: 1 }),
      draft('story-selection', 'mid', { jaccard: 0.5 }),
      draft('story-selection', 'far', { jaccard: 0.2 }),
    ]
    const { sets, key } = buildRatingDeliverable(drafts)
    expect(sets.sets[0].items).toHaveLength(2)
    expect(Object.keys(key)).toHaveLength(2)
    expect(sets.sets[0].items[0].context_md).toBe('Context')
  })

  it('honours the assessment strata (Han, non-English, differing ratings)', () => {
    const drafts = Array.from({ length: 40 }, (_, i) =>
      draft('full-assessment', `s${i}`, { han: i === 39, nonEnglish: i >= 36, differ: i % 5 === 0, band46: true }, undefined, `ctx-${i}`))
    const byContext = new Map(drafts.map(d => [d.context_md, d]))
    const picked = buildRatingDeliverable(drafts).sets.sets[0].items.map(item => byContext.get(item.context_md)!)
    expect(picked).toHaveLength(12)
    expect(picked.filter(d => d.tags.han)).toHaveLength(1)
    expect(picked.filter(d => d.tags.nonEnglish).length).toBeGreaterThanOrEqual(3)
    // All 8 drafts with differing ratings are preferred over the rest.
    expect(picked.filter(d => d.tags.differ)).toHaveLength(8)
  })
})

describe('validateRatingDeliverable', () => {
  const valid = () => {
    const built = buildRatingDeliverable([...many('newsletter-intro', 2), ...many('podcast-script', 1)])
    return { sets: JSON.parse(JSON.stringify(built.sets)) as RatingSetsFile, key: JSON.parse(JSON.stringify(built.key)) as Record<string, Record<string, string>> }
  }

  it('accepts a built deliverable', () => {
    const { sets, key } = valid()
    expect(validateRatingDeliverable(sets, key)).toEqual([])
  })

  it('rejects an extra key', () => {
    const { sets, key } = valid()
    expect(validateRatingDeliverable({ ...sets, extra: 1 }, key)).not.toEqual([])
  })

  it('rejects a missing key', () => {
    const { sets, key } = valid()
    const item = sets.sets[0].items[0] as Partial<(typeof sets.sets)[0]['items'][0]>
    delete item.context_md
    expect(validateRatingDeliverable(sets, key).join()).toMatch(/keys/)
  })

  it('rejects an option type other than text or image', () => {
    const { sets, key } = valid()
    ;(sets.sets[0].items[0].options[0] as { type: string }).type = 'audio'
    expect(validateRatingDeliverable(sets, key).join()).toMatch(/type audio/)
  })

  it('rejects a cap overrun', () => {
    const { sets, key } = valid()
    const podcast = sets.sets.find(s => s.id.endsWith('podcast-script'))!
    const extra = { ...podcast.items[0], id: `${podcast.id}-02` }
    podcast.items.push(extra)
    key[extra.id] = key[podcast.items[0].id]
    expect(validateRatingDeliverable(sets, key).join()).toMatch(/cap 1/)
  })

  it('rejects a key entry for a non-existent item', () => {
    const { sets, key } = valid()
    key['actually-relevant-podcast-script-09'] = { A: BASE, B: CAND }
    expect(validateRatingDeliverable(sets, key).join()).toMatch(/is not an item/)
  })

  it('rejects an item missing from the key', () => {
    const { sets, key } = valid()
    delete key[sets.sets[0].items[0].id]
    expect(validateRatingDeliverable(sets, key).join()).toMatch(/missing from the answer key/)
  })

  it('rejects a model name in a set title or option', () => {
    const { sets, key } = valid()
    sets.sets[0].title = 'Luna vs mini'
    sets.sets[1].items[0].options[0].content_md = 'Written by gpt-6-sol'
    const errors = validateRatingDeliverable(sets, key).join('\n')
    expect(errors).toMatch(/model name in title/)
    expect(errors).toMatch(/leak/)
  })

  it('rejects a model name in an item context', () => {
    const { sets, key } = valid()
    sets.sets[0].items[0].context_md = 'Artículo: el sol y la energía'
    expect(validateRatingDeliverable(sets, key).join('\n')).toMatch(/context_md: model name leak \(Sol\)/)
  })
})

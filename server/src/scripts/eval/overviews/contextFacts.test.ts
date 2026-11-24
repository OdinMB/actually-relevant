import { describe, it, expect } from 'vitest'
import { buildFactCheckPromptParts } from '../../../prompts/research.js'
import { factsOfItems, numberHints, publishedFact } from '../../../services/researchChecks.js'
import { factCheckItems, renderFact } from '../../../services/storyContextChecks.js'
import { contextFact } from '../../../test/contextFixtures.js'
import { contextCheckedItem, contextFactFixtures, contextVariants } from './contextFacts.js'
import { checkedItem, variantItems } from './factCheck.js'

const fire = contextFact('S0F1', {
  statement: 'Fires burned about 2.88 million hectares in Indonesia this year, the disaster agency said.',
  supportingSentence: 'Fires have burned 2.88 million hectares this year, the agency said on Friday.',
  value: 2_880_000,
  unit: 'hectares',
  approx: 'about',
  counted: 'total area burned',
  place: 'Indonesia',
  asOf: '2026-11',
  credited: "Indonesia's disaster agency",
})
const smoke = contextFact('S2F1', { place: 'Malaysia', credited: 'Greenpeace', verdict: 'supported' })
const rejected = contextFact('S2F2', { verdict: 'rejected' })
const reused = contextFact('S5F1', { reusedFromId: 'earlier-fact' })

describe('contextFactFixtures', () => {
  it("samples each story's own supported facts, rendered as production renders them, in turn from each story", () => {
    const sample = contextFactFixtures(
      [
        { slug: 'story-a', facts: [fire, smoke, rejected, reused] },
        { slug: 'story-b', facts: [contextFact('S0F1')] },
      ],
      10,
    )
    expect(sample.facts.map(f => f.key)).toEqual(['story-a:S0F1', 'story-b:S0F1', 'story-a:S2F1'])
    const [first] = sample.facts
    expect(first!.statement).toBe(renderFact(fire))
    expect(first!.sentence).toBe(fire.supportingSentence)
    expect(first!.context?.peers).toEqual({ places: ['Indonesia', 'Malaysia'], credits: ["Indonesia's disaster agency", 'Greenpeace'] })
    expect(sample.stories).toBe(2)
    expect(sample.shortfalls).toEqual(['3 of 10 facts: run 1 kept no more'])
  })

  it('stops at the size asked for', () => {
    expect(contextFactFixtures([{ slug: 'a', facts: [fire, smoke] }], 1).facts).toHaveLength(1)
  })
})

describe('contextVariants', () => {
  const [fx] = contextFactFixtures([{ slug: 'story-a', facts: [fire, smoke] }], 1).facts

  it('plants the text kinds in the rendering and the field kinds in the fields, rendered again', () => {
    const variants = contextVariants(fx!)
    const kinds = variants.map(v => v.kind)
    expect(kinds).toEqual(expect.arrayContaining(['faithful', 'wrong-number', 'wrong-place', 'wrong-as-of', 'wrong-credit', 'cumulative-swap']))
    const place = variants.find(v => v.kind === 'wrong-place')!
    expect(place.fact.place).toBe('Malaysia')
    expect(place.text).toBe(renderFact({ ...fire, place: 'Malaysia' }))
    const swap = variants.find(v => v.kind === 'cumulative-swap')!
    expect(swap.text).toContain('New area burned')
    expect(variants.find(v => v.kind === 'wrong-number')!.fact).toBe(fire)
  })

  it('reaches the fact check through variantItems', () => {
    expect(variantItems([fx!]).map(i => i.kind)).toEqual(contextVariants(fx!).map(v => v.kind))
  })
})

describe('contextCheckedItem', () => {
  it("carries production's evidence, named by the item's place, and number hints for the text shown", () => {
    const [production] = factCheckItems([fire])
    const same = contextCheckedItem(fire, renderFact(fire), 3)
    const [own] = production!.evidence
    expect(same).toEqual({
      label: 'Fact 3',
      text: renderFact(fire),
      facts: [{ ...own!, id: 'S3F1' }, ...publishedFact('S3', fire.source.outlet, fire.source.date)],
      numbersNotFound: production!.numberHints,
    })
    const planted = contextCheckedItem(fire, 'Total area burned: 4.32 million hectares', 1)
    expect(planted.numbersNotFound).toEqual(numberHints('Total area burned: 4.32 million hectares', production!.evidence))
  })

  it("keeps two stories' facts that share a ref apart in one call", () => {
    const other = contextFact('S0F1', { supportingSentence: 'Floods covered 40,000 hectares on Monday.', source: { ...fire.source, date: '2026-11-12' } })
    const items = [contextCheckedItem(fire, renderFact(fire), 1), contextCheckedItem(other, renderFact(other), 2)]
    const facts = factsOfItems(items, [])
    expect(facts.map(f => f.supportingSentence)).toEqual(expect.arrayContaining([fire.supportingSentence, other.supportingSentence]))
    expect(new Set(facts.map(f => f.id)).size).toBe(facts.length)
    expect(() => buildFactCheckPromptParts(items, [], [])).not.toThrow()
  })

  it('is what checkedItem builds for a module-1 variant', () => {
    const [fx] = contextFactFixtures([{ slug: 'story-a', facts: [fire, smoke] }], 1).facts
    const [item] = variantItems([fx!]).filter(i => i.kind === 'wrong-place')
    expect(checkedItem(item!, 2)).toEqual(contextCheckedItem({ ...fire, place: 'Malaysia' }, item!.text, 2))
  })
})

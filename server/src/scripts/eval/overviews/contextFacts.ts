/**
 * The planted-error fact check on module-1 facts (`eval:overviews --facts context`): the sample is
 * the facts the `context` step's run 1 kept on each story (supported by production's check, none
 * reused), each rendered by production's `renderFact` as the check reads it, with the story's
 * places and credited bodies for the field-level kinds. A fact's variants are the text kinds planted
 * in its rendering and the field kinds planted in its fields and rendered again; each item reaches
 * the check with production's evidence and number hints (`factCheckItems`). Pure.
 */
import { numberHints, publishedFact } from '../../../services/researchChecks.js'
import { factCheckItems, renderFact, type ContextFactData } from '../../../services/storyContextChecks.js'
import type { StoryContextResult } from '../../../services/storyContextPipeline.js'
import type { CheckedItem } from '../../../prompts/research.js'
import type { FactFixture } from './factFixtures.js'
import { plantFieldVariants, plantVariants, type VariantKind } from './plant.js'

export interface ContextFacts {
  /** Stories that gave facts. */
  stories: number
  size: number
  facts: FactFixture[]
  shortfalls: string[]
}

const distinct = (values: string[]) => {
  const seen = new Set<string>()
  return values.filter(v => {
    const k = v.trim().toLowerCase()
    if (!k || seen.has(k)) return false
    seen.add(k)
    return true
  })
}

const evidenceOf = (f: ContextFactData) => f.passage ?? f.supportingSentence

/** Each story's own supported facts, taken in turn from each story, at most `size`. */
export function contextFactFixtures(stories: { slug: string; result: StoryContextResult }[], size: number): ContextFacts {
  const lists = stories.map(({ slug, result }) => {
    const peers = { places: distinct(result.facts.map(f => f.place)), credits: distinct(result.facts.map(f => f.credited)) }
    return result.facts
      .filter(f => f.verdict === 'supported' && f.reusedFromId === null)
      .map((f): FactFixture => ({
        key: `${slug}:${f.ref}`,
        runId: `context:${slug}`,
        storyId: slug,
        sourceId: f.source.id,
        outlet: f.source.outlet,
        url: f.source.url,
        language: null,
        date: f.source.date,
        statement: renderFact(f),
        measures: f.counted,
        sentence: evidenceOf(f),
        context: { fact: f, peers },
      }))
  })
  const facts: FactFixture[] = []
  for (let i = 0; facts.length < size && lists.some(l => l.length > i); i++) for (const l of lists) if (l[i] && facts.length < size) facts.push(l[i]!)
  return {
    stories: lists.filter(l => l.length > 0).length,
    size,
    facts,
    shortfalls: facts.length < size ? [`${facts.length} of ${size} facts: the context step kept no more`] : [],
  }
}

export interface ContextVariant {
  kind: VariantKind
  text: string
  change: string
  /** The fact as this variant renders it: the sampled one, or with one field changed. */
  fact: ContextFactData
}

/** The faithful rendering and each kind that applies: the text kinds on the rendering, then the field kinds. */
export function contextVariants(fx: FactFixture): ContextVariant[] {
  if (!fx.context) return []
  const { fact, peers } = fx.context
  const rendered = renderFact(fact)
  const text = plantVariants(rendered).map(v => ({ ...v, fact }))
  const fields = plantFieldVariants(fact, peers, rendered, evidenceOf(fact)).flatMap(v => {
    const changed = { ...fact, ...v.fields }
    const shown = renderFact(changed)
    return shown === rendered ? [] : [{ kind: v.kind, text: shown, change: v.change, fact: changed }]
  })
  return [...text, ...fields]
}

/**
 * One item as production's fact check reads a module-1 fact, at its 1-based place in its call; `text`
 * is what the item shows. Its evidence is production's, named by the item's place as `checkedItem`
 * names a pool fact's (`S<position>F1` and its source's date fact): a call mixes stories, whose refs
 * are each story's own and may repeat.
 */
export function contextCheckedItem(fact: ContextFactData, text: string, position: number): CheckedItem {
  const [production] = factCheckItems([fact])
  const sourceId = `S${position}`
  const [own] = production!.evidence
  const evidence = [{ ...own!, id: `${sourceId}F1` }, ...publishedFact(sourceId, fact.source.outlet, fact.source.date)]
  return {
    label: `Fact ${position}`,
    text,
    facts: evidence,
    numbersNotFound: text === production!.item.text ? production!.numberHints : numberHints(text, evidence),
  }
}

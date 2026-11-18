/**
 * The `update` step's fixtures (`.plans/2026-11-17_research-passes.md`, "Evals and the gate",
 * "Update judgment"): a later pass's article step on our researched stories from the development
 * answer keys, each story's current version as the legacy import makes it (`readLegacyImport`), with
 * the facts a pass would have found since added to its pool as fresh facts. Four cases a story:
 *
 * - `key`: the later must entries within `UPDATE_WINDOW_DAYS` (at most `MAX_LATER_ENTRIES`) give
 *   their figure values and turning points as new facts. A section stating a figure value of the
 *   story's own entry that a later value of the same figure changes is expected flagged; each
 *   turning point is expected to found some section's rewrite. With no turning point, every other
 *   section is expected unchanged (routine entries change nothing).
 * - `wrong-number`, `wrong-year`: a fact contradicting one the story cites, built with `plant.ts`,
 *   for the same measure and moment (a correction, not a newer value): every section citing the old
 *   fact is expected flagged, and the old fact demoted.
 * - `benign`: the key's first near miss as a new fact on another subject: nothing expected.
 *
 * The facts the version cites count as supported, as a later pass's own fact check would have
 * judged the legacy pool's facts before its article step; the eval measures that step, not the check.
 * Pure.
 */
import { versionArticle } from '../../../services/articleVersions.js'
import { draftItems, type DraftItem } from '../../../services/researchChecks.js'
import type { UpdateInput } from '../../../services/researchPassLater.js'
import { nextSourceRef, usable, type ArticleVersionData, type Pool, type PoolFact, type PoolSource } from '../../../services/researchPool.js'
import { inHalf, type Half } from './contextScore.js'
import { normalizeQuote } from '../../../lib/quoteMatch.js'
import type { AnswerKey } from './keySchema.js'
import { wrongNumber, wrongYear, type Planted } from './plant.js'

/** How far after a story the later entries reach: a later pass's horizon. */
export const UPDATE_WINDOW_DAYS = 14
export const MAX_LATER_ENTRIES = 4
/** The pass the fresh facts are recorded as found by. */
export const UPDATE_PASS_ID = 'eval-update'

export const UPDATE_CASE_KINDS = ['key', 'wrong-number', 'wrong-year', 'benign'] as const
export type UpdateCaseKind = (typeof UPDATE_CASE_KINDS)[number]

/** A researched story as the step loads it: its day, its current version and its pool. */
export interface UpdateStory {
  slug: string
  /** `YYYY-MM-DD`. */
  storyDay: string
  version: ArticleVersionData
  pool: Pick<Pool, 'sources' | 'facts'>
}

export interface UpdateExpected {
  /** Sections the new facts make wrong or substantially different, each with why. */
  sections: { label: string; why: string }[]
  /** A turning point's fact: some section's rewrite must rest on it. */
  facts: { ref: string; why: string }[]
  /** Old facts the case must demote. */
  demote: string[]
  /** Whether every other section is expected unchanged: false once a turning point may reach any of them. */
  strict: boolean
}

export interface UpdateFixture {
  /** `<slug>:<kind>`. */
  id: string
  slug: string
  kind: UpdateCaseKind
  input: UpdateInput
  expected: UpdateExpected
  /** The story's own figure values a later value changes whose quote no section holds: left out of the expectations. */
  unplaced: string[]
}

export interface UpdateFixtures {
  fixtures: UpdateFixture[]
  /** Stories left out, and why. */
  left: { slug: string; reason: string }[]
}

const plusDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
const storyUrl = (slug: string) => `https://actuallyrelevant.news/stories/${slug}`
const APPROX_WORDS = { exact: '', at_least: 'at least ', about: 'about ', under: 'under ' } as const

/** The slugs the step loads: every must entry of the keys in the half, once. */
export function updateSlugs(keys: AnswerKey[], half: Half | 'all'): string[] {
  return [...new Set(keys.flatMap(k => k.entries.filter(e => e.join === 'must' && inHalf(e.slug, half)).map(e => e.slug)))]
}

interface NewFact {
  url: string
  title: string
  outlet: string
  date: string
  relation: string
  statement: string
  sentence: string
  measures: string
  asOf: string | null
  value?: { value: number; unit: string; approx: keyof typeof APPROX_WORDS }
}

/** The pool with each new fact on a source of its own, after the story's; the new facts' refs in order. */
function withNewFacts(pool: UpdateStory['pool'], add: NewFact[]): { pool: UpdateStory['pool']; refs: string[] } {
  const sources = [...pool.sources]
  const facts = [...pool.facts]
  const refs: string[] = []
  for (const n of add) {
    const ref = nextSourceRef(
      sources.map(s => s.ref),
      false,
    )
    const source: PoolSource = {
      id: null,
      ref,
      origin: 'search',
      earlierStoryId: null,
      url: n.url,
      outlet: n.outlet,
      title: n.title,
      date: n.date,
      kind: 'news-report',
      country: '',
      relation: n.relation,
      favicon: null,
      usedRawContent: false,
      voices: [],
      optOutChecked: false,
      firstPassId: UPDATE_PASS_ID,
    }
    const by = { model: 'answer-key', promptVersion: 'eval' }
    const fact: PoolFact = {
      id: null,
      ref: `${ref}F1`,
      sourceRef: ref,
      reusedFromId: null,
      supportingSentence: n.sentence,
      passage: null,
      supportFound: true,
      statement: n.statement,
      measures: n.measures,
      slot: null,
      structured: n.asOf
        ? {
            value: n.value?.value ?? null,
            valueHigh: null,
            unit: n.value?.unit ?? '',
            approx: n.value?.approx ?? 'exact',
            provisional: false,
            counted: '',
            place: '',
            asOf: n.asOf,
            credited: n.outlet,
            creditedKind: 'news',
            validity: 'fast',
            by,
          }
        : null,
      extractedBy: by,
      verdict: 'supported',
      verdictProblem: null,
      checkedBy: { ...by, passId: UPDATE_PASS_ID },
      status: 'unreviewed',
      firstPassId: UPDATE_PASS_ID,
      drop: null,
    }
    sources.push(source)
    facts.push(fact)
    refs.push(fact.ref)
  }
  return { pool: { sources, facts }, refs }
}

/** The first section whose text holds the quote, case and quotation marks aside. */
function sectionOf(items: DraftItem[], quote: string): string | null {
  const q = normalizeQuote(quote).toLowerCase()
  return items.find(i => normalizeQuote(i.text).toLowerCase().includes(q))?.label ?? null
}

/** A story's cases, in `UPDATE_CASE_KINDS` order; none for a story without a researched version. */
function storyCases(key: AnswerKey, index: number, story: UpdateStory): { fixtures: UpdateFixture[]; reason: string | null } {
  const entry = key.entries[index]!
  // The version's cited facts as the pass's own check would have left them: supported
  const article0 = versionArticle(story.version, story.pool)
  const cited = new Set(draftItems(article0).flatMap(i => i.factIds))
  const pool = {
    sources: story.pool.sources,
    facts: story.pool.facts.map(f => (cited.has(f.ref) && f.verdict === 'unjudged' ? { ...f, verdict: 'supported' as const } : f)),
  }
  const article = versionArticle(story.version, pool)
  const items = draftItems(article)
  const fixture = (kind: UpdateCaseKind, add: NewFact[], expected: (refs: string[]) => UpdateExpected, unplaced: string[] = []): UpdateFixture => {
    const next = withNewFacts(pool, add)
    return {
      id: `${story.slug}:${kind}`,
      slug: story.slug,
      kind,
      input: { storyDay: story.storyDay, version: story.version, pool: next.pool, fresh: new Set(next.refs) },
      expected: expected(next.refs),
      unplaced,
    }
  }
  const out: UpdateFixture[] = []

  // The later entries' figure values and turning points
  const figures = new Map(key.figures.map(f => [f.key, f]))
  const until = plusDays(entry.date, UPDATE_WINDOW_DAYS)
  const later = key.entries
    .slice(index + 1)
    .filter(e => e.join === 'must' && e.date > entry.date && e.date <= until)
    .slice(0, MAX_LATER_ENTRIES)
  if (later.length > 0) {
    const add: NewFact[] = []
    const turning: { at: number; why: string }[] = []
    for (const e of later) {
      const base = { url: storyUrl(e.slug), title: e.title, outlet: 'Actually Relevant', date: e.date, relation: 'same-development' }
      for (const v of e.values.filter(v => v.matches)) {
        const f = figures.get(v.figure)
        if (!f) continue
        add.push({
          ...base,
          statement: `${f.name} (${f.definition}): ${APPROX_WORDS[v.approx]}${v.value.toLocaleString('en-US')} ${f.unit} as of ${v.asOf}.`,
          sentence: v.quote,
          measures: `${f.name}: ${f.definition}`,
          asOf: v.asOf,
          value: { value: v.value, unit: f.unit, approx: v.approx },
        })
      }
      if (e.role === 'turning_point') {
        turning.push({ at: add.length, why: `${e.kind ?? 'turning point'}: ${e.title}` })
        add.push({ ...base, statement: e.title, sentence: e.title, measures: '', asOf: null })
      }
    }
    const sections = new Map<string, string>()
    const unplaced: string[] = []
    for (const v of entry.values.filter(v => v.matches)) {
      const newer = later.flatMap(e => e.values).find(w => w.matches && w.figure === v.figure && w.asOf > v.asOf && w.value !== v.value)
      if (!newer) continue
      const why = `${v.figure}: ${v.value} as of ${v.asOf} → ${newer.value} as of ${newer.asOf}`
      const label = sectionOf(items, v.quote)
      if (label === null) unplaced.push(why)
      else if (!sections.has(label)) sections.set(label, why)
    }
    if (add.length > 0) {
      out.push(
        fixture(
          'key',
          add,
          refs => ({
            sections: [...sections].map(([label, why]) => ({ label, why })),
            facts: turning.map(t => ({ ref: refs[t.at]!, why: t.why })),
            demote: [],
            strict: turning.length === 0,
          }),
          unplaced,
        ),
      )
    }
  }

  // A correction of a fact the story cites, for the same measure and moment
  const byRef = new Map(pool.facts.map(f => [f.ref, f]))
  const citedFacts = [...new Set(items.filter(i => i.cited).flatMap(i => i.factIds))].flatMap(ref => {
    const f = byRef.get(ref)
    return f && usable(f) ? [f] : []
  })
  for (const [kind, plant] of [
    ['wrong-number', wrongNumber],
    ['wrong-year', wrongYear],
  ] as const satisfies readonly (readonly [UpdateCaseKind, (text: string) => Planted | null])[]) {
    const hit = citedFacts.flatMap(f => {
      const planted = plant(f.statement)
      return planted ? [{ f, planted }] : []
    })[0]
    if (!hit) continue
    const { f, planted } = hit
    const why = `${f.ref} corrected: ${planted.change}`
    out.push(
      fixture(
        kind,
        [
          {
            url: `https://wire.example/correction/${encodeURIComponent(story.slug)}/${kind}`,
            title: 'Correction',
            outlet: 'Wire report',
            date: plusDays(story.storyDay, 2),
            relation: 'same-development',
            statement: planted.text,
            sentence: planted.text,
            measures: f.measures,
            asOf: f.structured?.asOf ?? null,
          },
        ],
        () => ({ sections: items.filter(i => i.factIds.includes(f.ref)).map(i => ({ label: i.label, why })), facts: [], demote: [f.ref], strict: true }),
      ),
    )
  }

  // A fact on another subject: the most tempting near miss
  const near = key.nearMisses[0]
  if (near) {
    out.push(
      fixture(
        'benign',
        [
          {
            url: storyUrl(near.slug),
            title: near.title,
            outlet: 'Actually Relevant',
            date: near.date,
            relation: 'background',
            statement: near.title,
            sentence: near.title,
            measures: '',
            asOf: null,
          },
        ],
        () => ({ sections: [], facts: [], demote: [], strict: true }),
      ),
    )
  }
  return { fixtures: out, reason: out.length === 0 ? 'no case: no later entry in the window, no plantable cited fact and no near miss' : null }
}

/** Every case of every researched must entry of the keys in the half, the first `limit` stories only. */
export function updateFixtures(keys: AnswerKey[], stories: ReadonlyMap<string, UpdateStory | null>, o: { half: Half | 'all'; limit?: number }): UpdateFixtures {
  const fixtures: UpdateFixture[] = []
  const left: UpdateFixtures['left'] = []
  const seen = new Set<string>()
  let taken = 0
  for (const key of keys) {
    for (const [index, entry] of key.entries.entries()) {
      if (entry.join !== 'must' || !inHalf(entry.slug, o.half) || seen.has(entry.slug)) continue
      seen.add(entry.slug)
      if (o.limit !== undefined && taken >= o.limit) continue
      const story = stories.get(entry.slug) ?? null
      if (!story) {
        left.push({ slug: entry.slug, reason: 'no researched version: not found, or never researched' })
        continue
      }
      const cases = storyCases(key, index, story)
      if (cases.reason) left.push({ slug: entry.slug, reason: cases.reason })
      else taken++
      fixtures.push(...cases.fixtures)
    }
  }
  return { fixtures, left }
}

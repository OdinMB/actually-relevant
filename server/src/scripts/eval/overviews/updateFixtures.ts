/**
 * The `update` step's fixtures (`.plans/2026-11-17_research-passes.md`, "Evals and the gate",
 * "Update judgment"): a later pass's article step on our researched stories from the development
 * answer keys, each story's version and pool from one of two sources: the legacy import of its
 * stored research (`readLegacyImport`), or the `pass-pool` step's first pass in the same run (its
 * version 1 and pool), with the facts a pass would have found since added to its pool as fresh facts.
 * Four cases a story:
 *
 * - `key`: the later must entries within `UPDATE_WINDOW_DAYS` (at most `MAX_LATER_ENTRIES`) give
 *   their figure values and turning points as new facts. A section stating a figure value of the
 *   story's own entry that a later value of the same figure changes is expected flagged; each
 *   turning point is expected to found some section's rewrite, its own fact or one of a later entry
 *   in the window (which supersedes it: a later pass gives the latest state). A turning point the
 *   story already states (`storyStates`) is left out. With no turning point left, every other section
 *   is expected unchanged (routine entries change nothing).
 * - `wrong-number`, `wrong-year`: a fact contradicting one the story cites, for the same measure and
 *   moment, that no newer value can explain (`updatePlants.ts`, which refuses nonsense plants): the
 *   sections citing the old fact that state the value it changes are expected flagged, the others
 *   citing it may change (code rewrites them once the fact is demoted), and the old fact demoted.
 * - `benign`: the key's first near miss as a new fact on another subject: nothing expected.
 *
 * The unjudged facts the version cites (the legacy import's) count as supported, as a later pass's
 * own fact check would have judged them before its article step; the eval measures that step, not the
 * check. A first pass's pool carries its own check's verdicts, which stand as they are. Pure.
 */
import { versionArticle } from '../../../services/articleVersions.js'
import { draftItems, type DraftItem } from '../../../services/researchChecks.js'
import type { UpdateInput } from '../../../services/researchPassLater.js'
import { nextSourceRef, usable, type ArticleVersionData, type Pool, type PoolFact, type PoolSource } from '../../../services/researchPool.js'
import { inHalf, type Half } from './contextScore.js'
import { normalizeQuote } from '../../../lib/quoteMatch.js'
import type { AnswerKey } from './keySchema.js'
import { statesValue } from './standsScore.js'
import { CORRECTION_KINDS, plantCorrections, type Correction, type CorrectionKind, type RefusalReason } from './updatePlants.js'

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
  /**
   * A turning point's fact: some section's rewrite must rest on it, or on a fact of a later entry in
   * the window (`supersededBy`), which takes the story past it.
   */
  facts: { ref: string; why: string; supersededBy: string[] }[]
  /**
   * Sections citing a planted fact without stating the value it changes: code rewrites them once the
   * fact is demoted, so they are neither expected changed nor a false rewrite.
   */
  free: string[]
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
  /** Turning points the story already states (`storyStates`): left out of the expectations. */
  stated: string[]
}

/** A change a correction case did not plant, and why (`updatePlants.ts`). */
export interface RefusedPlant {
  slug: string
  kind: CorrectionKind
  change: string
  reason: RefusalReason
}

export interface UpdateFixtures {
  fixtures: UpdateFixture[]
  /** Stories left out, and why. */
  left: { slug: string; reason: string }[]
  /** The changes the sanity check refused on the facts each correction case tried, before the one it planted. */
  refused: RefusedPlant[]
}

const plusDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
const storyUrl = (slug: string) => `https://actuallyrelevant.news/stories/${slug}`
const APPROX_WORDS = { exact: '', at_least: 'at least ', about: 'about ', under: 'under ' } as const

/** The slugs the step loads: every must entry of the keys in the half, once. */
export function updateSlugs(keys: AnswerKey[], half: Half | 'all'): string[] {
  return [...new Set(keys.flatMap(k => k.entries.filter(e => e.join === 'must' && inHalf(e.slug, half)).map(e => e.slug)))]
}

/** A fact a later pass would find, before it goes into the pool. */
export interface NewFact {
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

/** Short words that say nothing of what a headline reports. */
const FILLER = new Set(['with', 'from', 'after', 'over', 'into', 'amid', 'says', 'said', 'than', 'that', 'this', 'their', 'could', 'would', 'will', 'about'])

/** A headline's or a text's words as `storyStates` compares them: lowercase, four letters or more, a plain ending dropped; numbers of two digits or more. */
function stems(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/['’]s\b/g, '')
    .replace(/(?<=\d)[,.](?=\d)/g, '')
    .split(/[^\p{L}\p{N}]+/u)
  return new Set(
    words.flatMap(w => {
      if (/^\d+$/.test(w)) return w.length >= 2 ? [w] : []
      if (w.length < 4 || FILLER.has(w)) return []
      const stem = w.replace(/(?:ing|ed|es|s)$/, '')
      return [stem.length >= 4 ? stem : w]
    }),
  )
}

/** The share of a headline's words a text must hold for the text to state what it reports. */
export const STATED_SHARE = 0.8

/**
 * Whether the story's text already states what a later headline reports: at least three of the
 * headline's words, and at least `STATED_SHARE` of them, stand in the text. Errs toward "not stated",
 * so a turning point is left out of the expectations only when its words are nearly all there. Pure.
 */
export function storyStates(headline: string, text: string): boolean {
  const words = [...stems(headline)]
  const held = stems(text)
  return words.length >= 3 && words.filter(w => held.has(w)).length >= Math.ceil(words.length * STATED_SHARE)
}

/** A fact's moment: its as-of, else its source's day, else the story's. */
function momentOf(f: PoolFact, sources: ReadonlyMap<string, PoolSource>, storyDay: string): string {
  const day = /^\d{4}-\d{2}-\d{2}/.exec(sources.get(f.sourceRef)?.date ?? '')?.[0]
  return f.structured?.asOf ?? day ?? storyDay
}

/**
 * The correction a case plants: on the first cited fact (in the article's order) whose change makes
 * sense and whose old value a citing section states, else on the first whose change makes sense; and
 * the changes refused on the way.
 */
function pickCorrection(
  kind: CorrectionKind,
  cited: PoolFact[],
  items: DraftItem[],
  sources: ReadonlyMap<string, PoolSource>,
  storyDay: string,
): { chosen: { f: PoolFact; c: Correction } | null; refused: { change: string; reason: RefusalReason }[] } {
  const refused: { change: string; reason: RefusalReason }[] = []
  let first: { f: PoolFact; c: Correction } | null = null
  for (const f of cited) {
    const out = plantCorrections(kind, { statement: f.statement, sentence: f.supportingSentence, moment: momentOf(f, sources, storyDay) }, storyDay)
    refused.push(...out.refused)
    for (const c of out.planted) {
      first ??= { f, c }
      if (items.some(i => i.factIds.includes(f.ref) && statesValue(i.text, c.replaced))) return { chosen: { f, c }, refused }
    }
  }
  return { chosen: first, refused }
}

/**
 * What a later pass on the key's entry at `index` would find: the later must entries within
 * `UPDATE_WINDOW_DAYS` (at most `MAX_LATER_ENTRIES`), the new facts their matching figure values and
 * turning points give, and each turning point's index in those facts. Pure.
 */
export function laterFacts(key: AnswerKey, index: number): { later: AnswerKey['entries']; add: NewFact[]; turning: { at: number; why: string }[] } {
  const entry = key.entries[index]!
  const figures = new Map(key.figures.map(f => [f.key, f]))
  const until = plusDays(entry.date, UPDATE_WINDOW_DAYS)
  const later = key.entries
    .slice(index + 1)
    .filter(e => e.join === 'must' && e.date > entry.date && e.date <= until)
    .slice(0, MAX_LATER_ENTRIES)
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
  return { later, add, turning }
}

/** A story's cases, in `UPDATE_CASE_KINDS` order; none for a story without a researched version. */
function storyCases(key: AnswerKey, index: number, story: UpdateStory): { fixtures: UpdateFixture[]; reason: string | null; refused: RefusedPlant[] } {
  const entry = key.entries[index]!
  // The version's unjudged cited facts (the legacy import's) as the pass's own check would have left them: supported
  const article0 = versionArticle(story.version, story.pool)
  const cited = new Set(draftItems(article0).flatMap(i => i.factIds))
  const pool = {
    sources: story.pool.sources,
    facts: story.pool.facts.map(f => (cited.has(f.ref) && f.verdict === 'unjudged' ? { ...f, verdict: 'supported' as const } : f)),
  }
  const article = versionArticle(story.version, pool)
  const items = draftItems(article)
  const fixture = (
    kind: UpdateCaseKind,
    add: NewFact[],
    expected: (refs: string[]) => UpdateExpected,
    left: Pick<UpdateFixture, 'unplaced' | 'stated'> = { unplaced: [], stated: [] },
  ): UpdateFixture => {
    const next = withNewFacts(pool, add)
    return {
      id: `${story.slug}:${kind}`,
      slug: story.slug,
      kind,
      input: { storyDay: story.storyDay, version: story.version, pool: next.pool, fresh: new Set(next.refs) },
      expected: expected(next.refs),
      ...left,
    }
  }
  const out: UpdateFixture[] = []

  // The later entries' figure values and turning points
  const { later, add, turning } = laterFacts(key, index)
  if (add.length > 0) {
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
    const text = items.map(i => i.text).join('\n')
    const told = turning.filter(t => storyStates(add[t.at]!.statement, text))
    const required = turning.filter(t => !told.includes(t))
    out.push(
      fixture(
        'key',
        add,
        refs => ({
          sections: [...sections].map(([label, why]) => ({ label, why })),
          facts: required.map(t => ({
            ref: refs[t.at]!,
            why: t.why,
            supersededBy: refs.filter((_, i) => add[i]!.date > add[t.at]!.date),
          })),
          free: [],
          demote: [],
          strict: required.length === 0,
        }),
        { unplaced, stated: told.map(t => t.why) },
      ),
    )
  }

  // A correction of a fact the story cites, for the same measure and moment, that no newer value explains
  const byRef = new Map(pool.facts.map(f => [f.ref, f]))
  const sources = new Map(pool.sources.map(s => [s.ref, s]))
  const citedFacts = [...new Set(items.filter(i => i.cited).flatMap(i => i.factIds))].flatMap(ref => {
    const f = byRef.get(ref)
    return f && usable(f) ? [f] : []
  })
  const refused: RefusedPlant[] = []
  for (const kind of CORRECTION_KINDS) {
    const pick = pickCorrection(kind, citedFacts, items, sources, story.storyDay)
    refused.push(...pick.refused.map(r => ({ slug: story.slug, kind, ...r })))
    if (!pick.chosen) continue
    const { f, c } = pick.chosen
    const why = `${f.ref} corrected: ${c.change}`
    const citing = items.filter(i => i.factIds.includes(f.ref))
    const states = (i: DraftItem) => statesValue(i.text, c.replaced)
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
            statement: c.statement,
            sentence: c.sentence,
            measures: f.measures,
            // The old fact's own as-of, so the demotion rule never reads the plant as a later moment
            asOf: f.structured?.asOf ?? null,
          },
        ],
        () => ({
          sections: citing.filter(states).map(i => ({ label: i.label, why })),
          facts: [],
          free: citing.filter(i => !states(i)).map(i => i.label),
          demote: [f.ref],
          strict: true,
        }),
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
        () => ({ sections: [], facts: [], free: [], demote: [], strict: true }),
      ),
    )
  }
  return { fixtures: out, reason: out.length === 0 ? 'no case: no later entry in the window, no plantable cited fact and no near miss' : null, refused }
}

/** Which must entries a run reads: the keys' in the half, only the stories its source covers when it names them. */
interface UpdateScope {
  half: Half | 'all'
  /** The stories the source covers; the rest are not this run's, so they are neither cases nor left out. */
  only?: ReadonlySet<string>
}

/** Each must entry of the keys in the scope, once per slug, in key order. */
function mustEntries(keys: AnswerKey[], o: UpdateScope): { key: AnswerKey; index: number; entry: AnswerKey['entries'][number] }[] {
  const seen = new Set<string>()
  return keys.flatMap(key =>
    [...key.entries.entries()].flatMap(([index, entry]) => {
      if (entry.join !== 'must' || !inHalf(entry.slug, o.half) || seen.has(entry.slug)) return []
      seen.add(entry.slug)
      return !o.only || o.only.has(entry.slug) ? [{ key, index, entry }] : []
    }),
  )
}

/** Every case of every researched must entry of the keys in the scope, the first `limit` stories only. */
export function updateFixtures(
  keys: AnswerKey[],
  stories: ReadonlyMap<string, UpdateStory | null>,
  o: UpdateScope & {
    limit?: number
    /** Why a story in scope has no version. */
    missing?: string
  },
): UpdateFixtures {
  const fixtures: UpdateFixture[] = []
  const left: UpdateFixtures['left'] = []
  const refused: RefusedPlant[] = []
  let taken = 0
  for (const { key, index, entry } of mustEntries(keys, o)) {
    if (o.limit !== undefined && taken >= o.limit) continue
    const story = stories.get(entry.slug) ?? null
    if (!story) {
      left.push({ slug: entry.slug, reason: o.missing ?? 'no researched version: not found, or never researched' })
      continue
    }
    const cases = storyCases(key, index, story)
    if (cases.reason) left.push({ slug: entry.slug, reason: cases.reason })
    else taken++
    fixtures.push(...cases.fixtures)
    refused.push(...cases.refused)
  }
  return { fixtures, left, refused }
}

/**
 * The most cases each must entry in scope can give before its version exists (a dry run on stories a
 * pass has yet to research), the first `limit` stories only: a key case when later entries give new
 * facts, one correction case of each kind (whether a cited fact can be planted depends on the
 * article), a benign case when the key has a near miss. Pure.
 */
export function updateCaseCeiling(keys: AnswerKey[], o: UpdateScope & { limit?: number }): { stories: number; cases: Record<UpdateCaseKind, number> } {
  const entries = mustEntries(keys, o).slice(0, o.limit)
  const cases: Record<UpdateCaseKind, number> = { key: 0, 'wrong-number': 0, 'wrong-year': 0, benign: 0 }
  for (const { key, index } of entries) {
    if (laterFacts(key, index).add.length > 0) cases.key++
    cases['wrong-number']++
    cases['wrong-year']++
    if (key.nearMisses[0]) cases.benign++
  }
  return { stories: entries.length, cases }
}

/**
 * A later research pass's pure rules (`.context/research-passes.md`, "The later pass"; ADR-0068):
 * which old facts the newer ones demote, and which pairs are only a newer value (`demotions`); which
 * sections are rewritten and why, a section citing a demoted fact always, one the judge flags only on
 * a fact found since (`rewriteTargets`, the `unfounded` rule); what changed between two versions and
 * which sections stay as readers saw them (`versionChanges`); the Update note's code checks
 * (`checkNote`) and its fixed-line fallback (`fallbackNote`). No I/O and no model call:
 * `researchPassLater.ts` composes them with the judge, the rewrite and the note.
 */
import type { JudgeAnswer, SectionVerdict } from '../schemas/researchPass.js'
import { sectionTexts, isPageSection, type Kept } from './articleVersions.js'
import { draftItems, LABELS, type CitationProblem } from './researchChecks.js'
import type { CitedText, ResearchedStory } from './researchedStory.js'
import type { ArticleText } from './researchPipeline.js'
import type { VersionChange } from './researchPool.js'

/** The Update note's label in the checks and the record. */
export const NOTE_LABEL = 'Update note'

/** At most this many words in an Update note. */
export const NOTE_MAX_WORDS = 60

// ---------------------------------------------------------------------------
// Demotions
// ---------------------------------------------------------------------------

/** A fact as the demotion rule reads it: what it measures, and the moment it gives a value for. */
export interface RuleFact {
  measures: string
  /** The structured as-of date (`YYYY`, `YYYY-MM` or `YYYY-MM-DD`), or null when unknown. */
  asOf: string | null
}

/** An old fact newer reporting shows was wrong about its own moment: demoted, with the facts that show it. */
export interface Demotion {
  ref: string
  contradictedBy: string[]
  reason: string
}

export interface Demotions {
  demoted: Demotion[]
  /** Pairs the judge named that are only a newer value of the same measure: the old fact stays, a past value. */
  superseded: { ref: string; by: string[] }[]
}

const sameMeasure = (a: string, b: string) => {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
  return norm(a) !== '' && norm(a) === norm(b)
}

/** Whether `later` names a later moment than `earlier`, at the precision both give (`2026-11` is not later than `2026-11-20`'s month). */
const laterMoment = (later: string | null, earlier: string | null) => {
  if (!later || !earlier) return false
  const n = Math.min(later.length, earlier.length)
  return later.slice(0, n) > earlier.slice(0, n)
}

/**
 * The judge's contradicted pairs as demotions: the old fact must be one the pool held before this pass
 * and still usable (`old`), and at least one of its contradicting facts one this pass found and its
 * check supported (`fresh`); the others count for nothing. A pair whose every newer fact measures the
 * same thing as the old one as of a later moment is a newer value, not a contradiction: the old fact
 * is not demoted (the tile rule and validity already show the newest). A correction for the same
 * moment, or one whose moment is unknown, stays the judge's. One demotion per fact.
 */
export function demotions(
  contradicted: JudgeAnswer['contradicted'],
  facts: { old: ReadonlyMap<string, RuleFact>; fresh: ReadonlyMap<string, RuleFact> },
): Demotions {
  const out: Demotions = { demoted: [], superseded: [] }
  const seen = new Set<string>()
  for (const pair of contradicted) {
    const old = facts.old.get(pair.factId)
    if (!old || seen.has(pair.factId)) continue
    const by = [...new Set(pair.byFactIds)].filter(id => facts.fresh.has(id))
    if (by.length === 0) continue
    seen.add(pair.factId)
    const newer = by.every(id => {
      const f = facts.fresh.get(id)!
      return sameMeasure(old.measures, f.measures) && laterMoment(f.asOf, old.asOf)
    })
    if (newer) out.superseded.push({ ref: pair.factId, by })
    else out.demoted.push({ ref: pair.factId, contradictedBy: by, reason: pair.reason.trim() })
  }
  return out
}

// ---------------------------------------------------------------------------
// Rewrite targets
// ---------------------------------------------------------------------------

/**
 * What became of a section: `unchanged`; `rewrite`, flagged by the judge on a fact found since;
 * `demoted-fact`, citing a demoted fact, whatever the judge said; `unfounded`, flagged without naming
 * a new or demoted fact, and so left as it is; `follows-opening`, the title, summary or blurb checked
 * against a rewritten first paragraph.
 */
export type SectionOutcome = 'unchanged' | 'rewrite' | 'demoted-fact' | 'unfounded' | 'follows-opening'

export interface SectionJudgment {
  label: string
  /** The judge's verdict; null when its answer left the section out. */
  verdict: SectionVerdict | null
  /** The facts the judge named. */
  factIds: string[]
  reason: string
  outcome: SectionOutcome
  /** The new or demoted facts the rewrite rests on: what the note may cite. */
  founding: string[]
}

export interface RewritePlan {
  judgments: SectionJudgment[]
  /** The sections the rewrite takes up, each with what newer reporting changes in it. */
  targets: CitationProblem[]
  /** The problems that hold until a rewrite clears them: every target but those that only follow the opening. */
  standing: CitationProblem[]
}

const OPENING = LABELS.story(0)
const FOLLOWS_OPENING = new Set(['Title', 'Summary', 'Blurb'])

/**
 * The sections a later pass rewrites, in the article's order. A section citing a demoted fact (`demoted`:
 * this pass's and any earlier pass's) is always a target. One the judge flags is a target only when
 * the facts it names include one this pass found (`fresh`) or one demoted; otherwise it is
 * `unfounded` and stays as it is, so a rewrite always rests on a fact found since. When the first
 * paragraph is a target, the title, summary and blurb are taken up too, to be checked against it.
 */
export function rewriteTargets(
  article: ArticleText,
  judged: JudgeAnswer['sections'],
  facts: { fresh: ReadonlySet<string>; demoted: ReadonlyMap<string, string> },
): RewritePlan {
  const answers = new Map<string, JudgeAnswer['sections'][number]>()
  for (const s of judged) if (!answers.has(s.label)) answers.set(s.label, s)
  const items = draftItems(article)
  const judgments: SectionJudgment[] = []
  const targets: CitationProblem[] = []
  for (const item of items) {
    const a = answers.get(item.label)
    const base = { label: item.label, verdict: a?.verdict ?? null, factIds: a?.factIds ?? [], reason: a?.reason.trim() ?? '' }
    const problem = (text: string, by: CitationProblem['by']): CitationProblem => ({ label: item.label, text: item.text, problem: text, kind: 'fact', by })
    const demoted = item.factIds.filter(id => facts.demoted.has(id))
    if (demoted.length > 0) {
      const why = demoted.map(id => `${id}: ${facts.demoted.get(id) || 'newer reporting contradicts it'}`).join('; ')
      judgments.push({ ...base, outcome: 'demoted-fact', founding: demoted })
      targets.push(problem(`cites ${demoted.join(', ')}, which newer reporting contradicts (${why}); leave it out and say what the newer facts state`, 'code'))
      continue
    }
    if (!a || a.verdict === 'unchanged') {
      judgments.push({ ...base, outcome: 'unchanged', founding: [] })
      continue
    }
    const founding = [...new Set(a.factIds)].filter(id => facts.fresh.has(id) || facts.demoted.has(id))
    if (founding.length === 0) {
      judgments.push({ ...base, outcome: 'unfounded', founding: [] })
      continue
    }
    judgments.push({ ...base, outcome: 'rewrite', founding })
    const what = a.verdict === 'wrong' ? 'is wrong' : 'is substantially different'
    targets.push(problem(`${what} for newer reporting (${founding.join(', ')}): ${base.reason || 'the newer facts change what it states'}`, 'judge'))
  }

  const standing = [...targets]
  if (targets.some(t => t.label === OPENING)) {
    for (const j of judgments) {
      if (!FOLLOWS_OPENING.has(j.label) || targets.some(t => t.label === j.label)) continue
      const item = items.find(i => i.label === j.label)!
      j.outcome = 'follows-opening'
      targets.push({ label: j.label, text: item.text, problem: 'check it against the rewritten opening paragraph', kind: 'fact', by: 'code' })
    }
  }
  const order = new Map(items.map((i, n) => [i.label, n]))
  targets.sort((a, b) => order.get(a.label)! - order.get(b.label)!)
  return { judgments, targets, standing }
}

// ---------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------

const sameItem = (a: { text: string; factIds: string[] }, b: { text: string; factIds: string[] }) =>
  a.text === b.text && a.factIds.length === b.factIds.length && a.factIds.every((id, i) => id === b.factIds[i])

/** One version as readers see it: its article and its projection. */
export interface VersionText {
  article: ArticleText
  research: ResearchedStory
}

/**
 * What changed from `before` to `after`, in the article's order, and which cited sections stay as
 * readers saw them (`frozen`, for `withFrozen`). `after` is the article once the dropped sections
 * (`dropped`, by their labels before) left it; the rewrite moves no section, so the others keep their
 * order. A rewritten section is named by where it now is, a dropped one by where it was (`after:
 * null`); `before` is the section as readers saw it, its citations included.
 */
export function versionChanges(before: VersionText, after: VersionText, dropped: ReadonlySet<string>): { changes: VersionChange[]; frozen: Kept[] } {
  const was = sectionTexts(before.article, before.research)
  const now = sectionTexts(after.article, after.research)
  const uncited = (text: string): CitedText => ({ text, citations: [] })
  const changes: VersionChange[] = []
  const frozen: Kept[] = []
  const field = (label: string, old: string, fresh: string) => {
    if (old !== fresh) changes.push({ section: label, before: was.get(label) ?? uncited(old), after: now.get(label) ?? uncited(fresh) })
  }
  field('Title', before.article.title, after.article.title)
  for (const part of Object.keys(LABELS) as (keyof typeof LABELS)[]) {
    const olds = before.article[part]
    const fresh = after.article[part]
    let to = 0
    olds.forEach((old, from) => {
      const label = LABELS[part](from)
      if (dropped.has(label)) {
        changes.push({ section: label, before: was.get(label) ?? uncited(old.text), after: null })
        return
      }
      const next = fresh[to]
      if (next && sameItem(old, next)) frozen.push({ part, from, to })
      else if (next)
        changes.push({ section: LABELS[part](to), before: was.get(label) ?? uncited(old.text), after: now.get(LABELS[part](to)) ?? uncited(next.text) })
      to++
    })
  }
  field('Summary', before.article.summary, after.article.summary)
  field('Blurb', before.article.marketingBlurb, after.article.marketingBlurb)
  return { changes, frozen }
}

// ---------------------------------------------------------------------------
// The Update note
// ---------------------------------------------------------------------------

const QUOTATION_MARKS = /["“”„«»]/
const words = (text: string) => text.split(/\s+/).filter(Boolean).length

/**
 * The note's code checks, one line per problem: some text, at most `NOTE_MAX_WORDS` words, no
 * quotation marks, at most one em dash, citations of known facts only (`known`), and at least one
 * fact this pass found (`fresh`) or one demoted (`demoted`), so an Update always rests on what is
 * new. Research's fact check and both copying checks judge it besides (`researchPassLater.ts`).
 */
export function checkNote(
  note: { text: string; factIds: string[] },
  facts: { known: ReadonlySet<string>; fresh: ReadonlySet<string>; demoted: ReadonlySet<string> },
): string[] {
  const text = note.text.trim()
  if (text === '') return ['is empty']
  const problems: string[] = []
  const n = words(text)
  if (n > NOTE_MAX_WORDS) problems.push(`has ${n} words; an Update has at most ${NOTE_MAX_WORDS}`)
  if (QUOTATION_MARKS.test(text)) problems.push('quotes words; an Update has no quotation marks')
  if ((text.match(/—/g) ?? []).length > 1) problems.push('has more than one em dash')
  if (note.factIds.length === 0) problems.push('cites no fact')
  for (const id of note.factIds.filter(id => !facts.known.has(id))) problems.push(`cites ${id}, which is not among the facts`)
  if (note.factIds.length > 0 && !note.factIds.some(id => facts.fresh.has(id) || facts.demoted.has(id))) {
    problems.push('cites no fact found since the story was written or shown wrong by one')
  }
  return problems
}

const listed = (items: string[]) => (items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`)

/**
 * The fixed line a note that still fails after its repair round falls back to, from the changes and
 * the outlets of the facts they rest on: "Updated: Story paragraph 2 rewritten after new reporting
 * from Reuters." Sections shown on the page are named, the summary and blurb only when nothing else
 * changed. No new text then needs approval.
 */
export function fallbackNote(changes: VersionChange[], outlets: string[]): string {
  const shown = changes.filter(c => isPageSection(c.section))
  const named = shown.length > 0 ? shown : changes
  const rewritten = named.filter(c => c.after !== null).map(c => c.section)
  const removed = named.filter(c => c.after === null).map(c => c.section)
  const what = [...(rewritten.length > 0 ? [`${listed(rewritten)} rewritten`] : []), ...(removed.length > 0 ? [`${listed(removed)} removed`] : [])].join(
    ' and ',
  )
  const from = [...new Set(outlets.filter(Boolean))]
  return `Updated: ${what || 'the story revised'} after new reporting${from.length > 0 ? ` from ${listed(from)}` : ''}.`
}

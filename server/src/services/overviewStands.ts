/**
 * An overview's "Where this stands" and "What's being done" (`.context/overviews.md`, "Where this
 * stands"), over injected calls, the same in production and in the eval's sandbox: the facts offered
 * (the members' usable, structured page facts, deduplicated, each flagged current on today's date),
 * the write, the code checks (every line cites offered facts; a sentence stating an expired fact
 * carries its date; "What's being done" only from current facts), research's copying check and its
 * fact check with no repair round, and the filter every served version goes through. Overviews own no
 * fact: a line cites pool facts by row id. Pure.
 */
import { config } from '../config.js'
import type { CheckedItem } from '../prompts/research.js'
import { OVERVIEW_PROMPT_VERSIONS, type StandsPromptInput } from '../prompts/overviews.js'
import type { FactCheck } from '../schemas/research.js'
import type { StandsAnswer } from '../schemas/overviews.js'
import type { ModelCall } from './overviewLink.js'
import type { Role, StandsLine } from './overviewTypes.js'
import { judgedProblems, unjudgedLabels, type CheckedDraftItem } from './researchChecks.js'
import { checkCopying, sourceLines, type SourceLine } from './researchCopying.js'
import { contextFact, poolFactKey, usable, type PoolFact, type PoolSource, type Voice } from './researchPool.js'
import { citedCheckItem, promptItems, renderFact, wordingSources, type ContextFactData } from './storyContextChecks.js'
import { isCurrent, type ValidityWindows } from './storyContextVisuals.js'

export type StandsOptions = Pick<typeof config.overviews, 'maxStandsFacts' | 'minStandsFacts' | 'maxStandsSentences' | 'maxDoingSentences'>

const WINDOWS = (): ValidityWindows => ({ fastDays: config.storyContext.fastValidDays, slowDays: config.storyContext.slowValidDays })

/** A fact of a member's pool as the stands read it: its story, whether that story is published, the fact and its source. */
export interface MemberFact {
  storyId: string
  published: boolean
  fact: PoolFact
  source: PoolSource
}

/** A fact offered to the write. */
export interface OfferedFact {
  /** The pool fact's row id: what a stored line cites. */
  id: string
  storyId: string
  /** `S3F2`: unique within the overview's offer (each member's sources numbered in turn), as the write and the check cite it. */
  ref: string
  /** Judged on today's date: an overview speaks for now. */
  current: boolean
  /** As context's checks read it, under `ref` and its source's offer ref. */
  fact: ContextFactData
  voices: Voice[]
}

/** The day a fact is true for: its as-of date, else its source's date (`YYYY`, `YYYY-MM` or `YYYY-MM-DD`). */
const dayOf = (f: Pick<ContextFactData, 'asOf' | 'source'>): string | null => f.asOf ?? f.source.date

const currentOn = (f: ContextFactData, today: string, windows: ValidityWindows) => isCurrent({ ...f, sourceDate: f.source.date }, today, windows)

/**
 * The facts offered (step 1): the usable, structured page facts of published members, deduplicated by
 * their pool key (the first member's kept), never our own earlier stories' (`E…`); current on today's
 * date first, then newest first, up to `maxStandsFacts`, with every `response` fact on top, current or
 * not. Each member's sources are numbered in turn (`S1`, `S2` …), so refs repeat nowhere in the offer.
 */
export function standsFacts(members: readonly MemberFact[], today: string, options: StandsOptions = config.overviews, windows = WINDOWS()): OfferedFact[] {
  const seen = new Set<string>()
  const candidates: { m: MemberFact; id: string; fact: ContextFactData; current: boolean }[] = []
  for (const m of members) {
    if (!m.published || m.fact.id === null || !usable(m.fact) || m.fact.structured === null || m.source.origin === 'earlier') continue
    const key = poolFactKey(m.fact, m.source)
    if (seen.has(key)) continue
    seen.add(key)
    const fact = contextFact(m.fact, m.source)
    candidates.push({ m, id: m.fact.id, fact, current: currentOn(fact, today, windows) })
  }
  candidates.sort((a, b) => Number(b.current) - Number(a.current) || (dayOf(b.fact) ?? '').localeCompare(dayOf(a.fact) ?? '') || a.id.localeCompare(b.id))
  const capped = new Set(candidates.slice(0, options.maxStandsFacts))
  const offered = candidates.filter(c => capped.has(c) || c.fact.slot === 'response')

  const sourceRefs = new Map<string, string>()
  const factCounts = new Map<string, number>()
  return offered.map(c => {
    const sourceKey = `${c.m.storyId}:${c.m.source.ref}`
    const sourceRef = sourceRefs.get(sourceKey) ?? `S${sourceRefs.size + 1}`
    sourceRefs.set(sourceKey, sourceRef)
    const n = (factCounts.get(sourceRef) ?? 0) + 1
    factCounts.set(sourceRef, n)
    const ref = `${sourceRef}F${n}`
    return {
      id: c.id,
      storyId: c.m.storyId,
      ref,
      current: c.current,
      fact: { ...c.fact, ref, source: { ...c.fact.source, id: sourceRef } },
      voices: c.m.source.voices,
    }
  })
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

/** A month as a sentence may name it: in full, or its three-letter abbreviation with or without a period ("Sept." too). */
const monthPattern = (m: number) => {
  const name = MONTHS[m - 1]!
  return `(?:${name}|${name.slice(0, 3)}${name === 'september' ? 't?' : ''}\\.?)`
}

/**
 * Whether a sentence carries a fact's date, so a past value is stated with it: the date as written
 * (a year is only that), or for a day its month and day ("May 12", "12 May"), for a month its name.
 * A fact with no date carries none.
 */
export function carriesDate(text: string, f: Pick<ContextFactData, 'asOf' | 'source'>): boolean {
  const day = dayOf(f)
  if (!day) return false
  const t = text.toLowerCase()
  if (new RegExp(`(?<!\\d)${day}(?!\\d)`).test(t)) return true
  const [, m, d] = day.split('-').map(Number)
  if (!m) return false
  const month = monthPattern(m)
  if (!d) return new RegExp(`\\b${month}(?![a-z])`).test(t)
  return new RegExp(`\\b${month} ${d}(?!\\d)|\\b${d} ${month}(?![a-z])`).test(t)
}

/** A line as the write gave it, under its label (`Sentence 2`, `Doing 1`), citing offered refs. */
export interface DraftLine {
  part: 'sentence' | 'doing'
  label: string
  text: string
  refs: string[]
}

export type StandsDropCause = 'structure' | 'expired' | 'copying' | 'check' | 'unjudged'

export interface StandsDrop {
  label: string
  cause: StandsDropCause
  problem?: string
}

/**
 * The code checks on the write's answer (step 3, before the model's check): at most
 * `maxStandsSentences` sentences and `maxDoingSentences` lines of what is being done, in the order
 * written; a line with no text, or citing nothing or anything but offered facts, is dropped; a
 * sentence citing an expired fact must carry that fact's date, and a line of what is being done may
 * cite only current facts, or it is dropped.
 */
export function standsCodeChecks(
  answer: StandsAnswer,
  offered: ReadonlyMap<string, OfferedFact>,
  options: StandsOptions = config.overviews,
): { lines: DraftLine[]; drops: StandsDrop[] } {
  const drops: StandsDrop[] = []
  const lines: DraftLine[] = []
  const take = (part: DraftLine['part'], written: StandsAnswer['sentences'], cap: number) =>
    written.forEach((w, j) => {
      const label = `${part === 'sentence' ? 'Sentence' : 'Doing'} ${j + 1}`
      const refs = [...new Set(w.factIds.map(id => id.trim()))]
      const facts = refs.map(r => offered.get(r))
      const drop = (cause: StandsDropCause, problem: string) => drops.push({ label, cause, problem })
      if (j >= cap) return drop('structure', `over the ${cap} ${part === 'sentence' ? 'sentences' : 'lines'}`)
      if (!w.text.trim()) return drop('structure', 'no text')
      if (refs.length === 0 || facts.some(f => !f)) return drop('structure', 'cites no offered fact')
      const expired = facts.filter((f): f is OfferedFact => !f!.current)
      if (part === 'doing' && expired.length > 0) return drop('expired', 'what is being done cites a fact no longer current')
      const undated = expired.find(f => !carriesDate(w.text, f.fact))
      if (undated) return drop('expired', `states ${undated.ref}, no longer current, without its date`)
      lines.push({ part, label, text: w.text.trim(), refs })
    })
  take('sentence', answer.sentences, options.maxStandsSentences)
  take('doing', answer.doing, options.maxDoingSentences)
  return { lines, drops }
}

/**
 * Each line as an item of research's fact check, against the facts it cites, built by the cards' own
 * `citedCheckItem` (their rendering, their sources' words and dates, the number hints), so the stands
 * are judged as a card's sentence is. Sentence items do not depend on the day: only a card's tiles do.
 */
export function standsCheckItems(lines: readonly DraftLine[], facts: ReadonlyMap<string, ContextFactData>): CheckedDraftItem[] {
  return lines.map(l => citedCheckItem(l.label, l.text, l.refs, facts))
}

/** The stands write and research's fact check, as production's tiers make them and the sandbox replays them. */
export interface StandsDeps {
  write(input: StandsPromptInput): Promise<ModelCall<StandsAnswer>>
  check(items: CheckedItem[], lines: SourceLine[]): Promise<ModelCall<FactCheck>>
}

/** An overview as its stands are written: its title and its stories, oldest first (orientation only). */
export interface StandsSubject {
  title: string
  entries: { title: string; date: string; role: Role }[]
}

export type StandsOutcome = 'written' | 'none_kept' | 'too_few_facts' | 'failed'

export interface StandsResult {
  /** `written`: a new version; `none_kept`: nothing survived, the previous version stays; `too_few_facts`: no current version; `failed`: a call gave nothing. */
  outcome: StandsOutcome
  sentences: StandsLine[]
  doing: StandsLine[]
  offered: OfferedFact[]
  drops: StandsDrop[]
  /**
   * Lines the write gave within `maxStandsSentences` and `maxDoingSentences`, and those of them any
   * check dropped (code, copying, the model's), so `failed` never exceeds `checked`. Lines over the
   * limits are dropped and counted in neither.
   */
  checked: number
  failed: number
  costUsd: number
  /** The write's model; null without a write. */
  model: string | null
  promptVersion: string
}

const chunks = <T>(list: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size))

/**
 * Writes the stands from the facts offered (steps 2 and 3), never from the previous version: nothing
 * with fewer than `minStandsFacts` facts; then the write, the code checks, the copying check (a run of
 * `research.copiedRunWords` words) and research's fact check on every line, a failed or unjudged line
 * dropped, with no repair round. A version is written when at least one sentence survives.
 */
export async function refreshStands(
  subject: StandsSubject,
  offered: OfferedFact[],
  today: string,
  deps: StandsDeps,
  options: StandsOptions = config.overviews,
): Promise<StandsResult> {
  const result = (outcome: StandsOutcome, over: Partial<StandsResult> = {}): StandsResult => ({
    outcome,
    sentences: [],
    doing: [],
    offered,
    drops: [],
    checked: 0,
    failed: 0,
    costUsd: 0,
    model: null,
    promptVersion: OVERVIEW_PROMPT_VERSIONS.stands,
    ...over,
  })
  if (offered.length < options.minStandsFacts) return result('too_few_facts')

  const byRef = new Map(offered.map(o => [o.ref, o]))
  const write = await deps.write({
    title: subject.title,
    entries: subject.entries,
    facts: offered.map(o => ({
      id: o.ref,
      text: renderFact(o.fact),
      outlet: o.fact.source.outlet,
      date: dayOf(o.fact),
      current: o.current,
      response: o.fact.slot === 'response',
    })),
    today,
    maxSentences: options.maxStandsSentences,
    maxDoing: options.maxDoingSentences,
  })
  let costUsd = write.costUsd
  const model = write.model
  if (!write.parsed) return result('failed', { costUsd, model })

  const { lines, drops } = standsCodeChecks(write.parsed, byRef, options)
  const facts = new Map(offered.map(o => [o.ref, o.fact]))
  const wording = wordingSources(
    offered.map(o => o.fact),
    new Map(offered.map(o => [o.fact.source.id, o.voices])),
  )
  const sourceWording = sourceLines(wording)
  const failing = new Map<string, StandsDrop>()
  const draftItems = standsCheckItems(lines, facts)
  for (const p of checkCopying(
    draftItems.map(c => c.item),
    wording,
    config.research.copiedRunWords,
  ).problems)
    failing.set(p.label, { label: p.label, cause: 'copying', problem: p.problem })
  const toCheck = draftItems.filter(c => !failing.has(c.item.label))
  for (const batch of chunks(toCheck, config.storyContext.checkBatchSize)) {
    const check = await deps.check(promptItems(batch), sourceWording)
    costUsd += check.costUsd
    if (!check.parsed) return result('failed', { costUsd, model, drops: [...drops, ...failing.values()] })
    for (const p of judgedProblems(check.parsed, batch, sourceWording))
      if (!failing.has(p.label)) failing.set(p.label, { label: p.label, cause: p.kind === 'copying' ? 'copying' : 'check', problem: p.problem })
    for (const label of unjudgedLabels(check.parsed, batch)) if (!failing.has(label)) failing.set(label, { label, cause: 'unjudged' })
  }
  const kept = lines.filter(l => !failing.has(l.label))
  const stored = (part: DraftLine['part']): StandsLine[] =>
    kept.filter(l => l.part === part).map(l => ({ text: l.text, facts: l.refs.map(r => byRef.get(r)!.id) }))
  const sentences = stored('sentence')
  const allDrops = [...drops, ...failing.values()]
  // Checked: every line written within the limits; failed: those any check dropped, so never more than checked
  const written = Math.min(write.parsed.sentences.length, options.maxStandsSentences) + Math.min(write.parsed.doing.length, options.maxDoingSentences)
  const over = { costUsd, model, drops: allDrops, checked: written, failed: written - kept.length }
  return sentences.length > 0 ? result('written', { ...over, sentences, doing: stored('doing') }) : result('none_kept', over)
}

/**
 * What decides a refresh: the facts offered with their current flags, and the entries with their
 * roles. A refresh is due when it differs from the last attempt's (an entry gained or lost, a member's
 * pool gained usable facts, a cited fact demoted or expired, a role changed).
 */
export function standsSignature(offered: readonly OfferedFact[], entries: readonly { storyId: string; role: Role }[]): string {
  const facts = offered.map(o => `${o.id}:${o.current ? 'c' : 'e'}`).sort()
  const members = entries.map(e => `${e.storyId}:${e.role.role}:${e.role.roleKind ?? ''}`).sort()
  return `${facts.join(',')}|${members.join(',')}`
}

/** A fact a served line cites, as it stands now. */
export interface ServedFact {
  usable: boolean
  /** Its story is published. */
  published: boolean
  fact: ContextFactData
}

/**
 * The stands as served, whatever the job has done since (`.context/overviews.md`, "Where this stands"):
 * a line citing a fact that is gone or no longer usable is dropped (a later pass demoted it); so is one
 * whose cited facts all belong to unpublished members, a sentence stating a fact expired since without
 * its date, and a line of what is being done citing a fact no longer current. A kept line cites only
 * its published members' facts.
 */
export function servedStands(
  stands: { sentences: StandsLine[]; doing: StandsLine[] },
  facts: ReadonlyMap<string, ServedFact>,
  today: string,
  windows = WINDOWS(),
): { sentences: StandsLine[]; doing: StandsLine[] } {
  const serve = (part: DraftLine['part']) => (line: StandsLine) => {
    const cited = line.facts.map(id => facts.get(id))
    if (cited.length === 0 || cited.some(f => !f?.usable)) return []
    const shown = line.facts.filter(id => facts.get(id)!.published)
    if (shown.length === 0) return []
    const expired = cited.filter(f => !currentOn(f!.fact, today, windows))
    if (part === 'doing' ? expired.length > 0 : expired.some(f => !carriesDate(line.text, f!.fact))) return []
    return [{ text: line.text, facts: shown }]
  }
  return { sentences: stands.sentences.flatMap(serve('sentence')), doing: stands.doing.flatMap(serve('doing')) }
}

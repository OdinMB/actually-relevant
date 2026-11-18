/**
 * The `update` step's scores against the plan's bars (`.plans/2026-11-17_research-passes.md`, "Evals
 * and the gate"), each run of the fixtures scored on its own and the bars read on the mean over the
 * runs (ADR-0066):
 *
 * - `flagged`: of the expected changes (a section a changed figure or a planted correction makes
 *   wrong, a turning point some rewrite rests on), the share the judge flagged on the right section;
 *   at least 90%.
 * - `false-rewrites`: of the sections a case expects unchanged (its strict cases only), the share
 *   rewritten; at most 10%.
 * - `identical`: of the sections no change names, in an updated version, the share byte-identical
 *   to the version before; a code assertion, 100%.
 * - `demoted`: of the planted contradictions, the share whose old fact was demoted; at least 90%.
 * - `false-demotions`: of the cases, the share demoting a fact they do not expect; at most 5%.
 * - `notes`: of the served notes the strong judge read, the share accurate and complete; at least 90%.
 * - `unsupported`: served notes that production's checks did not pass (the fixed line aside); none.
 * - `copying`: the share of written notes a copying check flagged, against the rewritten sections'
 *   share; no higher.
 *
 * A case the budget or a failed call stopped (`budget`, `technical`) is counted but measured by no
 * bar. Pure.
 */
import { sectionTexts, versionArticle } from '../../../services/articleVersions.js'
import type { UpdateOutcome, UpdateResult } from '../../../services/researchPassLater.js'
import { spread, type Spread } from '../repeats.js'
import type { UpdateCaseKind, UpdateFixture } from './updateFixtures.js'

export const FLAGGED_BAR = 0.9
export const FALSE_REWRITE_BAR = 0.1
export const DEMOTED_BAR = 0.9
export const FALSE_DEMOTION_BAR = 0.05
export const NOTE_BAR = 0.9
/** Misses, false rewrites and demotions, and notes judged short, listed for a read. */
export const MAX_LISTED = 30

export interface NoteVerdict {
  accurate: boolean
  complete: boolean
  problem: string
}

/** One case's run of production's article step, with the strong judge's verdict on its note. */
export interface UpdateRun {
  fixture: UpdateFixture
  /** 1-based. */
  run: number
  result: UpdateResult
  /** Null when the result has no note, or the judge gave no verdict. */
  note: NoteVerdict | null
}

const REWRITTEN = new Set(['rewrite', 'demoted-fact'])
const MEASURED = (r: UpdateRun) => r.result.outcome !== 'budget' && r.result.outcome !== 'technical'
const share = (part: number, whole: number) => (whole === 0 ? null : part / whole)
const partOf = (label: string) => label.replace(/\s+\d+$/, '')
const isPlanted = (kind: UpdateCaseKind) => kind === 'wrong-number' || kind === 'wrong-year'

interface Count {
  of: number
  hit: number
  share: number | null
}
const count = (hit: number, of: number): Count => ({ of, hit, share: share(hit, of) })

export interface UpdateRunScore {
  run: number
  cases: number
  outcomes: Record<UpdateOutcome, number>
  flagged: Count
  falseRewrites: Count
  identical: Count
  demoted: Count
  falseDemotions: Count
  notes: Count & { served: number; fallback: number; unsupported: number }
  copying: { notes: Count; paragraphs: Count }
}

/** The sections no change names, and how many of them read byte for byte as before. */
function identity(r: UpdateRun): { of: number; hit: number } {
  const next = r.result.next
  if (!next) return { of: 0, hit: 0 }
  const { version, pool } = r.fixture.input
  const before = sectionTexts(versionArticle(version, pool), version.research)
  const after = [...sectionTexts(next.article, next.research)]
  const named = new Set(next.changes.map(c => c.section))
  let of = 0
  let hit = 0
  for (const [label, text] of before) {
    if (named.has(label)) continue
    of++
    const json = JSON.stringify(text)
    if (after.some(([l, t]) => partOf(l) === partOf(label) && JSON.stringify(t) === json)) hit++
  }
  return { of, hit }
}

/** The rewritten sections' checks: how many cited sections were checked, and how many a copying check flagged. */
function paragraphCopying(r: UpdateRun): { of: number; hit: number } {
  let of = 0
  let hit = 0
  for (const pass of r.result.record.checks) {
    const labels = (pass.rechecked ?? []).filter(l => /^(Story paragraph|Why This Matters|Caveat) \d+$/.test(l))
    of += labels.length
    hit += labels.filter(l => pass.problems.some(p => p.label === l && p.kind === 'copying')).length
  }
  return { of, hit }
}

function runScore(run: number, runs: UpdateRun[]): UpdateRunScore {
  const outcomes = { updated: 0, unchanged: 0, update_failed: 0, budget: 0, technical: 0 } satisfies Record<UpdateOutcome, number>
  for (const r of runs) outcomes[r.result.outcome]++
  const measured = runs.filter(MEASURED)
  const tally: Record<'flagged' | 'falseRewrites' | 'identical' | 'demoted' | 'falseDemotions' | 'paragraphs', [hit: number, of: number]> = {
    flagged: [0, 0],
    falseRewrites: [0, 0],
    identical: [0, 0],
    demoted: [0, 0],
    falseDemotions: [0, 0],
    paragraphs: [0, 0],
  }
  const add = (k: keyof typeof tally, hit: number, of: number) => {
    tally[k][0] += hit
    tally[k][1] += of
  }
  const notes = { served: 0, fallback: 0, unsupported: 0, judged: 0, good: 0, checked: 0, copied: 0 }
  for (const r of measured) {
    const { expected, kind } = r.fixture
    const judgments = r.result.record.judgments
    const rewritten = judgments.filter(j => REWRITTEN.has(j.outcome))
    const rewrittenLabels = new Set(rewritten.map(j => j.label))
    add('flagged', expected.sections.filter(s => rewrittenLabels.has(s.label)).length, expected.sections.length)
    add('flagged', expected.facts.filter(f => rewritten.some(j => j.founding.includes(f.ref))).length, expected.facts.length)
    if (expected.strict) {
      const wanted = new Set(expected.sections.map(s => s.label))
      const others = judgments.filter(j => !wanted.has(j.label) && j.outcome !== 'follows-opening')
      add('falseRewrites', others.filter(j => REWRITTEN.has(j.outcome)).length, others.length)
    }
    const same = identity(r)
    add('identical', same.hit, same.of)
    const demoted = new Set(r.result.demoted.map(d => d.ref))
    if (isPlanted(kind)) add('demoted', expected.demote.filter(ref => demoted.has(ref)).length, expected.demote.length)
    add('falseDemotions', [...demoted].some(ref => !expected.demote.includes(ref)) ? 1 : 0, 1)
    const p = paragraphCopying(r)
    add('paragraphs', p.hit, p.of)
    const note = r.result.record.note
    if (r.result.next && note) {
      notes.served++
      if (note.fallback) notes.fallback++
      else if (note.problems.length > 0) notes.unsupported++
      if (r.note) {
        notes.judged++
        if (r.note.accurate && r.note.complete) notes.good++
      }
      notes.checked += note.checked
      notes.copied += note.copied
    }
  }
  const c = (k: keyof typeof tally) => count(...tally[k])
  return {
    run,
    cases: runs.length,
    outcomes,
    flagged: c('flagged'),
    falseRewrites: c('falseRewrites'),
    identical: c('identical'),
    demoted: c('demoted'),
    falseDemotions: c('falseDemotions'),
    notes: { ...count(notes.good, notes.judged), served: notes.served, fallback: notes.fallback, unsupported: notes.unsupported },
    copying: { notes: count(notes.copied, notes.checked), paragraphs: c('paragraphs') },
  }
}

export const UPDATE_BAR_NAMES = ['flagged', 'false-rewrites', 'identical', 'demoted', 'false-demotions', 'notes', 'unsupported', 'copying'] as const
export type UpdateBarName = (typeof UPDATE_BAR_NAMES)[number]

export interface UpdateBar {
  name: UpdateBarName
  /** The mean over the runs; null when no run measured it. `copying` is the notes' share less the paragraphs'. */
  value: number | null
  spread: Spread | null
  met: boolean | null
}

const copyingGap = (s: UpdateRunScore) =>
  s.copying.notes.share === null || s.copying.paragraphs.share === null
    ? s.copying.notes.share === 0
      ? 0
      : null
    : s.copying.notes.share - s.copying.paragraphs.share

const BAR_RULES: { name: UpdateBarName; of: (s: UpdateRunScore) => number | null; ok: (v: number) => boolean }[] = [
  { name: 'flagged', of: s => s.flagged.share, ok: v => v >= FLAGGED_BAR },
  { name: 'false-rewrites', of: s => s.falseRewrites.share, ok: v => v <= FALSE_REWRITE_BAR },
  { name: 'identical', of: s => s.identical.share, ok: v => v === 1 },
  { name: 'demoted', of: s => s.demoted.share, ok: v => v >= DEMOTED_BAR },
  { name: 'false-demotions', of: s => s.falseDemotions.share, ok: v => v <= FALSE_DEMOTION_BAR },
  { name: 'notes', of: s => s.notes.share, ok: v => v >= NOTE_BAR },
  { name: 'unsupported', of: s => (s.notes.served === 0 ? null : s.notes.unsupported), ok: v => v === 0 },
  { name: 'copying', of: copyingGap, ok: v => v <= 0 },
]

export interface UpdateListed {
  missed: { id: string; run: number; what: string; why: string }[]
  falseRewrites: { id: string; run: number; label: string; reason: string }[]
  falseDemotions: { id: string; run: number; ref: string; reason: string }[]
  notes: { id: string; run: number; note: string; problem: string }[]
}

export interface UpdateScore {
  runs: UpdateRunScore[]
  bars: UpdateBar[]
  listed: UpdateListed
}

function listed(runs: UpdateRun[]): UpdateListed {
  const out: UpdateListed = { missed: [], falseRewrites: [], falseDemotions: [], notes: [] }
  for (const r of runs.filter(MEASURED)) {
    const { id, expected } = r.fixture
    const rewritten = r.result.record.judgments.filter(j => REWRITTEN.has(j.outcome))
    for (const s of expected.sections) if (!rewritten.some(j => j.label === s.label)) out.missed.push({ id, run: r.run, what: s.label, why: s.why })
    for (const f of expected.facts) if (!rewritten.some(j => j.founding.includes(f.ref))) out.missed.push({ id, run: r.run, what: f.ref, why: f.why })
    if (expected.strict) {
      for (const j of rewritten) {
        if (!expected.sections.some(s => s.label === j.label)) out.falseRewrites.push({ id, run: r.run, label: j.label, reason: j.reason })
      }
    }
    for (const d of r.result.demoted) if (!expected.demote.includes(d.ref)) out.falseDemotions.push({ id, run: r.run, ref: d.ref, reason: d.reason })
    if (r.note && !(r.note.accurate && r.note.complete)) out.notes.push({ id, run: r.run, note: r.result.record.note?.text ?? '', problem: r.note.problem })
  }
  return {
    missed: out.missed.slice(0, MAX_LISTED),
    falseRewrites: out.falseRewrites.slice(0, MAX_LISTED),
    falseDemotions: out.falseDemotions.slice(0, MAX_LISTED),
    notes: out.notes.slice(0, MAX_LISTED),
  }
}

export function scoreUpdates(runs: UpdateRun[]): UpdateScore {
  const numbers = [...new Set(runs.map(r => r.run))].sort((a, b) => a - b)
  const scores = numbers.map(n =>
    runScore(
      n,
      runs.filter(r => r.run === n),
    ),
  )
  const bars = BAR_RULES.map(rule => {
    const s = spread(scores.map(rule.of))
    return { name: rule.name, value: s?.mean ?? null, spread: s, met: s ? rule.ok(s.mean) : null }
  })
  return { runs: scores, bars, listed: listed(runs) }
}

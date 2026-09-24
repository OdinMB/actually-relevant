/**
 * The owner's acceptance rules for the phase-2 prompt recalibration (rating
 * scale) and dedup tightening, decided 2026-09-24, and the deterministic
 * calibration/holdout split they are judged on. Pure.
 *
 * Reference numbers are phase 1's (DOCS/2026-09-24_gpt6-eval/results.md),
 * measured on the prompts as they were before the recalibration. Ratings are
 * judged against the stored production values, which are the archive the site
 * must stay comparable with.
 */
import { config } from '../../config.js'
import { ASSESS_FORMAT_CHECKS, num, pct, type AssessFormatCheck } from './checks.js'
import type { AssessItem, DedupSet, PreassessItem } from './fixtures.js'
import { splitHalves, type Half } from './sampling.js'
import type { AssessArmMetrics } from './suites/assess.js'
import { scoreDedupArm, type PairLabel, type Vote } from './suites/dedup.js'
import type { PreassessArmMetrics } from './suites/preassess.js'

const GATE = config.assess.fullAssessmentThreshold
const SPLIT = config.selection.relevanceMin

/** Phase-1 gpt-6-luna@medium pre-assessment agreement with stored values; the recalibrated prompt must not do worse. */
export const PHASE1_PREASSESS = { issueAgreement: 0.74, emotionAgreement: 0.703, emotionAim: 0.716 }

/** Phase-1 gpt-5-mini@medium full-assessment format pass rates (50 stories). */
export const PHASE1_MINI_FORMAT: Record<AssessFormatCheck, number> = {
  factorCount: 1, limitingCount: 1, calculationCount: 1, summaryWords: 1, relevanceSummaryWords: 0.78, titleWords: 1,
  titleNoColon: 0.98, labelWords: 1, labelTitleDistinct: 1, blurbLength: 1, factorFormat: 1, dateFormat: 1,
}

export const TOLERANCE = {
  /** Mean rating offset against stored values, both stages. */
  meanShift: 0.25,
  /** Share rated 5 or more against the stored share, in absolute points. */
  passShare: 0.05,
  /** Share of published stories that pass the pre-assessment gate. */
  publishedPass: 0.75,
  /** "Clearly more" confirmed duplicates than gpt-5-nano: recall at least this many points higher. */
  recallMargin: 0.15,
}

// ---------------------------------------------------------------------------
// Sample
// ---------------------------------------------------------------------------

export interface RecalibrationSample {
  preassess: PreassessItem[]
  assess: AssessItem[]
  dedup: DedupSet[]
}

/**
 * The phase-1 sample, or one half of it. Strata keep what the acceptance
 * measures balanced between the halves: published and stored-gate outcome for
 * pre-assessment, stored split and language for full assessment, set kind for dedup.
 */
export function sampleFor(fx: RecalibrationSample, half: Half | 'all'): RecalibrationSample {
  if (half === 'all') return { preassess: fx.preassess, assess: fx.assess, dedup: fx.dedup }
  return {
    preassess: splitHalves(fx.preassess, s => s.id, s => `${s.status === 'published'}|${s.stored.rating >= GATE}`)[half],
    assess: splitHalves(fx.assess, s => s.id, s => `${s.stored.rating >= SPLIT}|${s.language !== 'en'}`)[half],
    dedup: splitHalves(fx.dedup, s => s.sourceId, s => s.kind)[half],
  }
}

// ---------------------------------------------------------------------------
// Criteria
// ---------------------------------------------------------------------------

export interface Criterion {
  name: string
  value: string
  bar: string
  pass: boolean
  /** False for a target that is reported but not required (the emotion aim). */
  required: boolean
}

/** Rounding slack, so a rate equal to its bar is not failed by float error. */
const EPS = 1e-9

function criterion(name: string, value: number | null, bar: string, ok: (v: number) => boolean, format: (v: number | null) => string, required = true): Criterion {
  return { name, value: format(value), bar, pass: value != null && ok(value), required }
}

const offset = (name: string, shift: number | null) =>
  criterion(name, shift, `within ±${TOLERANCE.meanShift}`, v => Math.abs(v) <= TOLERANCE.meanShift + EPS, v => num(v))

function shareNearStored(name: string, share: number | null, stored: number | null): Criterion {
  const bar = `within ${TOLERANCE.passShare * 100} points of stored ${pct(stored)}`
  return criterion(name, share, bar, v => stored != null && Math.abs(v - stored) <= TOLERANCE.passShare + EPS, pct)
}

const atLeast = (name: string, value: number | null, bar: number, source: string, required = true) =>
  criterion(name, value, `≥ ${pct(bar)} (${source})`, v => v >= bar - EPS, pct, required)

export function preassessCriteria(m: PreassessArmMetrics): Criterion[] {
  return [
    offset('Mean rating offset vs stored', m.meanShift),
    shareNearStored(`Share passing the ≥${GATE} gate`, m.passRate, m.storedPassRate),
    atLeast('Published stories passing the gate', m.publishedRecall, TOLERANCE.publishedPass, 'owner'),
    atLeast('Issue agreement with stored', m.issueAgreement, PHASE1_PREASSESS.issueAgreement, 'phase 1'),
    atLeast('Emotion agreement with stored', m.emotionAgreement, PHASE1_PREASSESS.emotionAgreement, 'phase 1'),
    atLeast('Emotion agreement, owner\'s aim', m.emotionAgreement, PHASE1_PREASSESS.emotionAim, 'aim, not required', false),
  ]
}

export function assessCriteria(m: AssessArmMetrics): Criterion[] {
  return [
    offset('Mean rating offset vs stored', m.vsStored.shift),
    shareNearStored(`Share rated ≥${SPLIT}`, m.atLeastSplit, m.storedAtLeastSplit),
    ...ASSESS_FORMAT_CHECKS.map(k => atLeast(`Format: ${k}`, m.format[k], PHASE1_MINI_FORMAT[k], 'gpt-5-mini, phase 1')),
    {
      name: 'Outputs with meta-commentary about the input',
      value: `${m.metaCommentary.length} of ${m.ok}`,
      bar: '0 (owner, phase 2)',
      pass: m.ok > 0 && m.metaCommentary.length === 0,
      required: true,
    },
  ]
}

export interface DedupCounts {
  /** Labelled-distinct pairs called duplicates: each would auto-reject a story. */
  wrongMerges: number
  distinct: number
  /** Labelled duplicates confirmed. */
  caught: number
  duplicates: number
}

/** Counts over labelled pairs only; contested pairs are left out. */
export function dedupCounts(votes: Vote[][], labels: PairLabel[][]): DedupCounts {
  const scored = scoreDedupArm(votes, labels)
  const flat = labels.flat()
  const duplicates = flat.filter(l => l === 'dup').length
  return {
    wrongMerges: scored.falsePositives,
    distinct: flat.filter(l => l === 'not').length,
    caught: duplicates - scored.missedDuplicates,
    duplicates,
  }
}

export interface DedupPair {
  source: string
  candidate: string
}

/** The pairs behind the counts, by title, for tuning the prompt wording. */
export function dedupMistakes(sets: DedupSet[], votes: Vote[][], labels: PairLabel[][]): { wrongMerges: DedupPair[]; missed: DedupPair[] } {
  const wrongMerges: DedupPair[] = []
  const missed: DedupPair[] = []
  sets.forEach((set, s) => set.candidates.forEach((c, i) => {
    const pair = { source: set.source.title, candidate: c.title }
    const said = votes[s]?.[i] === true
    if (said && labels[s]?.[i] === 'not') wrongMerges.push(pair)
    if (!said && labels[s]?.[i] === 'dup') missed.push(pair)
  }))
  return { wrongMerges, missed }
}

const recallOf = (c: DedupCounts) => (c.duplicates === 0 ? null : c.caught / c.duplicates)

/** Luna against gpt-5-nano on the same labelled pairs (nano's phase-1 verdicts). */
export function dedupCriteria(luna: DedupCounts, nano: DedupCounts): Criterion[] {
  const nanoRecall = recallOf(nano)
  const lunaRecall = recallOf(luna)
  const recallBar = nanoRecall == null ? null : Math.min(1, nanoRecall + TOLERANCE.recallMargin)
  return [
    {
      name: 'Wrong merges (labelled distinct pairs called duplicates)',
      value: `${luna.wrongMerges} of ${luna.distinct}`,
      bar: `≤ ${nano.wrongMerges} (gpt-5-nano)`,
      pass: luna.wrongMerges <= nano.wrongMerges,
      required: true,
    },
    {
      name: 'Confirmed duplicates caught',
      value: `${luna.caught} of ${luna.duplicates} (${pct(lunaRecall)})`,
      bar: `≥ ${pct(recallBar)} (gpt-5-nano ${nano.caught} of ${nano.duplicates} plus ${TOLERANCE.recallMargin * 100} points, at most all)`,
      pass: lunaRecall != null && recallBar != null && lunaRecall >= recallBar - EPS,
      required: true,
    },
  ]
}

/** Every required criterion passes. */
export const accepted = (criteria: Criterion[]) => criteria.every(c => c.pass || !c.required)

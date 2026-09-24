/**
 * Dedup-confirmation suite. Ground truth: a pair's label is the unanimous
 * verdict of the three arms; where they disagree, two strong judges assess the
 * whole set with the unchanged production prompt, and pairs the judges split
 * on are excluded. Existing clusters were created by gpt-5-nano, so they are
 * reported only as a secondary signal.
 */
import { buildDedupPrompt } from '../../../prompts/dedup.js'
import { dedupConfirmationSchema, type DedupConfirmation } from '../../../schemas/llm.js'
import type { DedupSet, Fixtures } from '../fixtures.js'
import { TARGETS } from '../fixtures.js'
import { arm, armKey, estimateCallUsd } from '../models.js'
import { pct, rate } from '../checks.js'
import { pickLowestPassing } from '../decide.js'
import type { Arm, CallRecord, Decision, Suite } from '../types.js'
import { limited, metricRow, parsedOf, runArms, statsFor } from './shared.js'

const BASELINE = arm('gpt-5-nano', 'medium')
const CANDIDATES = [arm('gpt-6-luna', 'low'), arm('gpt-6-luna', 'medium')]
const ARMS = [BASELINE, ...CANDIDATES]
const JUDGES = [arm('gpt-5.2', 'high'), arm('gpt-6-sol', 'high')]
const SCHEMA = 'dedup'
const BASE_OUTPUT_TOKENS = 2000
/** Dry-run assumption for the share of sets the judges must see (plan: 15-40%). */
const ASSUMED_DISPUTED_SHARE = 0.3

const sets = (fx: Fixtures, limit?: number) => limited(fx.dedup, limit)
const promptFor = (s: DedupSet) => buildDedupPrompt(s.source, s.candidates.map(c => ({ id: c.id, title: c.title, summary: c.summary })))

type Vote = boolean | null
export type PairLabel = 'dup' | 'not' | 'disputed' | 'contested'

export function votesFrom(parsed: DedupConfirmation | null, candidateCount: number): { votes: Vote[]; outOfRange: number } {
  const votes: Vote[] = Array(candidateCount).fill(null)
  let outOfRange = 0
  for (const a of parsed?.assessments ?? []) {
    if (a.candidateNumber >= 1 && a.candidateNumber <= candidateCount) votes[a.candidateNumber - 1] = a.isDuplicate
    else outOfRange++
  }
  return { votes, outOfRange }
}

const unanimous = (votes: Vote[]): Vote => (votes.every(v => v !== null && v === votes[0]) ? votes[0] : null)

/** Arm votes per candidate (outer index: arm). */
export function isDisputed(armVotes: Vote[][]): boolean {
  return armVotes[0].some((_, i) => unanimous(armVotes.map(v => v[i])) === null)
}

export function labelSet(armVotes: Vote[][], judgeVotes?: Vote[][]): PairLabel[] {
  return armVotes[0].map((_, i) => {
    const agreed = unanimous(armVotes.map(v => v[i]))
    if (agreed !== null) return agreed ? 'dup' : 'not'
    if (!judgeVotes) return 'disputed'
    const judged = unanimous(judgeVotes.map(v => v[i]))
    if (judged === null) return 'contested'
    return judged ? 'dup' : 'not'
  })
}

export interface DedupArmMetrics {
  fpRate: number | null
  recall: number | null
  labelledPairs: number
  missing: number
  outOfRange: number
  failures: number
  agreementWithBaseline: number | null
  clusterAgreement: number | null
}

/** FP rate and recall over labelled pairs only; a missing verdict counts as "not a duplicate" (production behaviour). */
export function scoreDedupArm(votes: Vote[][], labels: PairLabel[][]): Pick<DedupArmMetrics, 'fpRate' | 'recall' | 'labelledPairs'> {
  let fp = 0
  let tn = 0
  let tp = 0
  let fn = 0
  votes.forEach((setVotes, s) => setVotes.forEach((vote, i) => {
    const label = labels[s]?.[i]
    const said = vote === true
    if (label === 'dup') {
      if (said) tp++
      else fn++
    } else if (label === 'not') {
      if (said) fp++
      else tn++
    }
  }))
  return {
    fpRate: fp + tn === 0 ? null : fp / (fp + tn),
    recall: tp + fn === 0 ? null : tp / (tp + fn),
    labelledPairs: fp + tn + tp + fn,
  }
}

export function decideDedup(metrics: Record<string, DedupArmMetrics>, baseline: string, candidates: string[]): Decision {
  const b = metrics[baseline]
  return pickLowestPassing(
    candidates.filter(c => metrics[c]).map(c => {
      const m = metrics[c]
      return {
        arm: c,
        failures: [
          ...((m.fpRate ?? 1) > (b.fpRate ?? 0) ? [`false-positive rate ${pct(m.fpRate)} > nano ${pct(b.fpRate)}`] : []),
          ...((m.recall ?? 0) < (b.recall ?? 0) - 0.05 ? [`recall ${pct(m.recall)} < nano ${pct(b.recall)} − 5 pts`] : []),
        ],
        evidence: [`FP rate ${pct(m.fpRate)} (nano ${pct(b.fpRate)}), recall ${pct(m.recall)} (nano ${pct(b.recall)}) over ${m.labelledPairs} labelled pairs`],
      }
    }),
  )
}

async function judgeDisputed(
  ctx: Parameters<Suite['run']>[1],
  all: DedupSet[],
  armVotes: Vote[][][],
): Promise<{ labels: PairLabel[][]; judgeRecords: Map<string, CallRecord<DedupConfirmation>[]> }> {
  const disputed = all.map((_, s) => isDisputed(armVotes[s]))
  const judged = all.filter((_, s) => disputed[s])
  const judgeRecords = await runArms(ctx, JUDGES, judged, SCHEMA, dedupConfirmationSchema, promptFor)
  let j = 0
  const labels = all.map((set, s) => {
    if (!disputed[s]) return labelSet(armVotes[s])
    const idx = j++
    const judgeVotes = JUDGES.map(a => votesFrom(parsedOf(judgeRecords.get(armKey(a))?.[idx]), set.candidates.length).votes)
    return labelSet(armVotes[s], judgeVotes)
  })
  return { labels, judgeRecords }
}

function votesByArm(all: DedupSet[], records: Map<string, CallRecord<DedupConfirmation>[]>, a: Arm) {
  return all.map((set, s) => votesFrom(parsedOf(records.get(armKey(a))?.[s]), set.candidates.length))
}

export const dedupSuite: Suite = {
  name: 'dedup',
  arms: [...ARMS, ...JUDGES],
  describe(fx, limit) {
    const s = sets(fx, limit)
    const count = (k: DedupSet['kind']) => s.filter(x => x.kind === k).length
    return [
      `dedup: ${s.length} source sets, ${s.reduce((n, x) => n + x.candidates.length, 0)} pairs; ` +
        `${count('cluster-member')} cluster members (target ${TARGETS.dedup.clusterMembers}), ` +
        `${count('hard-negative')} hard negatives (${TARGETS.dedup.hardNegatives}), ${count('random')} random (${TARGETS.dedup.random})`,
    ]
  },
  plan(fx, limit) {
    return sets(fx, limit).flatMap(s => ARMS.map(a => ({ arm: a, schemaName: SCHEMA, prompt: promptFor(s), baseOutputTokens: BASE_OUTPUT_TOKENS })))
  },
  extraEstimateUsd(fx, limit) {
    const perSet = (s: DedupSet) => JUDGES.reduce((sum, a) => sum + estimateCallUsd({ arm: a, schemaName: SCHEMA, prompt: promptFor(s), baseOutputTokens: BASE_OUTPUT_TOKENS }), 0)
    return sets(fx, limit).reduce((sum, s) => sum + perSet(s), 0) * ASSUMED_DISPUTED_SHARE
  },
  async run(fx, ctx) {
    const all = sets(fx, ctx.limit)
    const records = await runArms(ctx, ARMS, all, SCHEMA, dedupConfirmationSchema, promptFor)
    const perArm = new Map(ARMS.map(a => [armKey(a), votesByArm(all, records, a)]))
    const armVotes = all.map((_, s) => ARMS.map(a => perArm.get(armKey(a))?.[s].votes ?? []))
    const { labels, judgeRecords } = await judgeDisputed(ctx, all, armVotes)
    const baseVotes = perArm.get(armKey(BASELINE)) ?? []

    const metrics: Record<string, DedupArmMetrics> = Object.fromEntries(ARMS.map(a => {
      const v = perArm.get(armKey(a)) ?? []
      const flat = v.flatMap(x => x.votes)
      const base = baseVotes.flatMap(x => x.votes)
      const clusterTruth = all.flatMap(set => set.candidates.map(c => c.sameCluster))
      return [armKey(a), {
        ...scoreDedupArm(v.map(x => x.votes), labels),
        missing: flat.filter(x => x === null).length,
        outOfRange: v.reduce((n, x) => n + x.outOfRange, 0),
        failures: (records.get(armKey(a)) ?? []).filter(r => r.outcome !== 'ok' && r.outcome !== 'skipped').length,
        agreementWithBaseline: rate(flat.map((x, i) => (x === true) === (base[i] === true))),
        clusterAgreement: rate(flat.map((x, i) => (x === true) === clusterTruth[i])),
      }]
    }))
    const flatLabels = labels.flat()
    const disputedSets = all.filter((_, s) => isDisputed(armVotes[s])).length
    return {
      callSites: [{
        id: 'dedup',
        title: 'Dedup confirmation',
        baseline: armKey(BASELINE),
        candidates: CANDIDATES.map(armKey),
        stats: [...statsFor(records), ...statsFor(judgeRecords)],
        metrics: [
          metricRow('False-positive rate (labelled pairs)', metrics, m => m.fpRate, pct, 'lower'),
          metricRow('Recall (labelled pairs)', metrics, m => m.recall, pct, 'higher'),
          metricRow('Pair agreement with nano', metrics, m => m.agreementWithBaseline, pct),
          metricRow('Agreement with existing clusters (secondary)', metrics, m => m.clusterAgreement, pct),
          metricRow('Candidates without a verdict', metrics, m => m.missing, v => String(v ?? 0), 'lower'),
          metricRow('Out-of-range candidate numbers', metrics, m => m.outOfRange, v => String(v ?? 0), 'lower'),
          metricRow('Failed calls', metrics, m => m.failures, v => String(v ?? 0), 'lower'),
        ],
        decision: decideDedup(metrics, armKey(BASELINE), CANDIDATES.map(armKey)),
        notes: [
          `${flatLabels.length} pairs in ${all.length} sets: ${flatLabels.filter(l => l === 'dup').length} labelled duplicate, ` +
            `${flatLabels.filter(l => l === 'not').length} labelled distinct, ${flatLabels.filter(l => l === 'contested').length} excluded because the judges split.`,
          `${disputedSets} sets (${pct(all.length ? disputedSets / all.length : null)}) went to the judges (${JUDGES.map(armKey).join(', ')}).`,
          'Candidates include auto-rejected duplicates and stories up to 14 days after the source, so later duplicates of an earlier story are present.',
        ],
      }],
      ratingItems: [],
      notes: [],
    }
  },
}

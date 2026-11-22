/**
 * The `review` step (`.context/model-eval.md`, "Overview evals"; plan "Evals and bars"): production's
 * review (`reviewOverview`, the actions code allows) of each development of the half with at least 3
 * must entries, its overview built from the key with errors planted: up to `PLANTED_JOINS` of its near
 * misses inserted as entries, one entry's role flipped (never one that accepts either role, whose
 * relabel is never a demotion either), the charter's OUT list emptied. On the eval's
 * cached calls at the review tier; `reviewScore.ts` scores the bars. Each run k ≥ 2 has its own cache
 * keys; developments start only while the budget lasts.
 */
import { reviewOverview, type ReviewCase, type ReviewEntry } from '../../../services/overviewReview.js'
import type { LinkStory, Role } from '../../../services/overviewTypes.js'
import { runNumbers } from '../repeats.js'
import type { SuiteContext } from '../types.js'
import { inDevelopmentHalf } from './developmentHalves.js'
import type { KeyFile } from './keyFiles.js'
import type { AnswerKey } from './keySchema.js'
import { scoreReviews, type ReviewCaseRun, type ReviewScore } from './reviewScore.js'
import { keyRole } from './stands.js'
import { upkeepCalls } from './upkeepCalls.js'

/** Near misses planted as wrong joins in each development, at most. */
export const PLANTED_JOINS = 2

export interface ReviewStepOptions {
  ctx: SuiteContext & { spentUsd(): number }
  files: KeyFile[]
  half: 'tune' | 'judge' | 'all'
  stories(slugs: string[]): Promise<Map<string, LinkStory | null>>
  repeat: number
  budgetUsd: number
  limit?: number
}

export interface ReviewStepReport {
  half: ReviewStepOptions['half']
  repeat: number
  keys: string[]
  cases: ReviewCaseRun[]
  score: ReviewScore
  costUsd: number
  stopped?: string
}

const flipped = (r: Role): Role => (r.role === 'routine' ? { role: 'turning_point', roleKind: 'milestone' } : { role: 'routine', roleKind: null })

/** A development's overview with its plants, or null with fewer than 3 must entries published here. */
export function plantedCase(
  key: AnswerKey,
  stories: ReadonlyMap<string, LinkStory | null>,
): (Omit<ReviewCaseRun, 'run' | 'outcome' | 'actions' | 'costUsd'> & { review: ReviewCase }) | null {
  const entry = (s: LinkStory, role: Role, id: string): ReviewEntry => ({
    entryId: id,
    storyId: s.id,
    title: s.title,
    label: s.label,
    summary: s.summary,
    date: s.date,
    role,
    locked: false,
  })
  const musts = key.entries.flatMap(e => {
    const s = e.join === 'must' ? stories.get(e.slug) : null
    return s ? [{ e, s }] : []
  })
  if (musts.length < 3) return null
  // The middle must entry is flipped; flipping one that accepts either role plants nothing, so then the nearest that does not (the earlier one first).
  const middle = Math.floor(musts.length / 2)
  const byNearness = musts.map((m, i) => ({ m, d: Math.abs(i - middle) + (i < middle ? 0 : 0.5) })).sort((a, b) => a.d - b.d)
  const flip = byNearness.find(({ m }) => !m.e.eitherRole)?.m ?? null
  const correct = musts.map(({ e, s }) => ({
    entry: entry(s, e === flip?.e ? flipped(keyRole(e)) : keyRole(e), `key:${e.slug}`),
    keyRole: keyRole(e),
    eitherRole: e.eitherRole,
    slug: e.slug,
  }))
  const joins = key.nearMisses
    .flatMap(n => {
      const s = stories.get(n.slug)
      return s ? [entry(s, { role: 'routine', roleKind: null }, `planted:${n.slug}`)] : []
    })
    .slice(0, PLANTED_JOINS)
  const entries = [...correct.map(c => c.entry), ...joins].sort((a, b) => a.date.localeCompare(b.date) || a.entryId.localeCompare(b.entryId))
  return {
    key: key.id,
    plantedJoins: joins.map(j => j.entryId),
    plantedRole: flip ? { entryId: `key:${flip.e.slug}`, keyRole: keyRole(flip.e) } : null,
    correct: correct.filter(c => c.slug !== flip?.e.slug).map(c => ({ entryId: c.entry.entryId, keyRole: c.keyRole, eitherRole: c.eitherRole })),
    review: {
      overviewId: `review:${key.id}`,
      title: key.title,
      charter: { ...key.charter, out: [] },
      scope: 'forming',
      frozen: false,
      entries,
      lockedOut: [],
    },
  }
}

export async function runReviewStep(o: ReviewStepOptions): Promise<ReviewStepReport> {
  const all = o.files.flatMap(f => (f.key && f.errors.length === 0 && inDevelopmentHalf(f.key.id, o.half) ? [f.key] : []))
  const keys = o.limit !== undefined ? all.slice(0, o.limit) : all
  const stories = await o.stories([...new Set(keys.flatMap(k => [...k.entries.map(e => e.slug), ...k.nearMisses.map(n => n.slug)]))])
  const planned = keys.flatMap(k => plantedCase(k, stories) ?? [])
  const spentBefore = o.ctx.spentUsd()
  const cases: ReviewCaseRun[] = []
  let stopped: string | undefined
  for (const run of runNumbers(o.repeat)) {
    const calls = upkeepCalls(o.ctx, run)
    for (const p of planned) {
      if (o.ctx.spentUsd() >= o.budgetUsd) {
        stopped = `the budget ran out in run ${run}: the developments after it were not reviewed`
        break
      }
      const result = await reviewOverview(p.review, 'entries', calls.review)
      const { review: _review, ...plants } = p
      cases.push({ ...plants, run, outcome: result.outcome, actions: result.actions, costUsd: result.costUsd })
    }
    if (stopped) break
  }
  return {
    half: o.half,
    repeat: o.repeat,
    keys: planned.map(p => p.key),
    cases,
    score: scoreReviews(cases),
    costUsd: o.ctx.spentUsd() - spentBefore,
    ...(stopped ? { stopped } : {}),
  }
}

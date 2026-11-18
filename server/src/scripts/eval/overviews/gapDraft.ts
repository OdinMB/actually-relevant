/**
 * Drafting the gap keys (the `gap-draft` step of `eval:overviews`; plan
 * `.plans/2026-11-16_story-context.md`, "The gap key: how it is drafted and checked"): the sample of
 * 30 one-off stories, and one call per story to the strong model with the eval-only drafting prompt
 * (`prompts.ts`), written as a draft key to `--out/gap-drafts/<slug>.json` with the format's errors
 * listed, for the coordinating session to check against its story and commit to `gapKeys/`.
 *
 * The sample: published stories of the 4 months up to the newest published one, each with a
 * completed research run whose sources hold facts, none an entry or near miss of a development key,
 * in the eval's hash order, spread round robin over the strata of top-level issue × figure-heavy
 * (at least 3 significant numbers in the published text) or figure-light (`stratifiedPick`); cached
 * in `.cache/gap-sample.json`. The drafter sees each story's published text and its research run's
 * fact statements, never what the context step finds. The candidates' SELECT runs through the
 * read-only session; the rest is pure but for the calls and the files written.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { readNumbers, significant } from '../../../lib/numbers.js'
import { storedResearchText } from '../../../services/researchedStory.js'
import type { ContextInput } from '../../../services/storyContextPipeline.js'
import { versionedSchemaName } from '../models.js'
import type { SelectDb } from '../readOnlyDb.js'
import { byEvalHash, stratifiedPick } from '../sampling.js'
import type { CallOutcome, PlannedCall, SuiteContext } from '../types.js'
import { estimateCalls, refusal, type CallEstimate, type CallGate, type Ledger } from './callBudget.js'
import { LABEL_ARM } from './factCheck.js'
import { parseGapKey } from './gapKeySchema.js'
import { keySlugs } from './keyCheck.js'
import type { KeyFile } from './keyFiles.js'
import { buildGapDraftPrompt, gapDraftSchema, storyTextOf, type GapDraftAnswer } from './prompts.js'

export const GAP_SAMPLE_SIZE = 30
export const GAP_WINDOW_MONTHS = 4
/** Significant numbers in the published text that make a story figure-heavy. */
export const FIGURE_HEAVY_MIN = 3
/** The drafter: the strong arm the fact check's labels and the context judge run on. */
export const DRAFT_ARM = LABEL_ARM
const DRAFT_SCHEMA = versionedSchemaName('overview-gap-draft', gapDraftSchema)
/** Billed output per draft at medium effort, reasoning included: the estimate only. */
const DRAFT_OUTPUT_TOKENS = 2500
export const GAP_SAMPLE_VERSION = 1

/** A story the sample may pick. */
export interface GapCandidate {
  id: string
  slug: string
  /** Its top-level issue's slug (the parent of its issue, else the issue, else its feed's), or `none`. */
  issue: string
  /** Its UTC publication day. */
  day: string
  /** Significant numbers in its published text. */
  figures: number
}

interface CandidateRow {
  id: string
  slug: string
  title: string | null
  summary: string | null
  relevance_reasons: string | null
  research: unknown
  date_published: Date
  issue: string
}

/** The candidates, and the newest published story's day the window counts back from. */
export async function loadGapCandidates(db: SelectDb): Promise<{ anchor: string | null; candidates: GapCandidate[] }> {
  const [newest] = await db.$queryRaw<{ anchor: Date | null }[]>`SELECT max(s.date_published) AS anchor FROM stories s WHERE s.status = 'published'`
  if (!newest?.anchor) return { anchor: null, candidates: [] }
  const rows = await db.$queryRaw<CandidateRow[]>`
    SELECT s.id, s.slug, s.title, s.summary, s.relevance_reasons, s.research, s.date_published,
           COALESCE(pi.slug, i.slug, 'none') AS issue
    FROM stories s
    JOIN feeds f ON f.id = s.feed_id
    LEFT JOIN issues i ON i.id = COALESCE(s.issue_id, f.issue_id)
    LEFT JOIN issues pi ON pi.id = i.parent_id
    WHERE s.status = 'published' AND s.slug IS NOT NULL AND s.date_published IS NOT NULL
      AND s.date_published >= ${newest.anchor}::timestamp - (${GAP_WINDOW_MONTHS} * interval '1 month')
      AND EXISTS (
        SELECT 1 FROM story_research_runs r
        WHERE r.story_id = s.id AND r.status = 'completed' AND jsonb_path_exists(r.result, '$.sources[*].facts[*]')
      )`
  return {
    anchor: newest.anchor.toISOString().slice(0, 10),
    candidates: rows.map(r => ({
      id: r.id,
      slug: r.slug,
      issue: r.issue,
      day: r.date_published.toISOString().slice(0, 10),
      figures: [r.title, r.summary, r.relevance_reasons, storedResearchText(r.research)]
        .filter((t): t is string => !!t)
        .flatMap(t => readNumbers(t).filter(significant)).length,
    })),
  }
}

/** Every slug a development key names, entries and near misses: none of them is a one-off story. */
export const developmentSlugs = (files: KeyFile[]): Set<string> => new Set(files.flatMap(f => (f.key ? keySlugs(f.key) : [])))

export const stratumOf = (c: Pick<GapCandidate, 'issue' | 'figures'>) => `${c.issue} · ${c.figures >= FIGURE_HEAVY_MIN ? 'figure-heavy' : 'figure-light'}`

/** The sample: the candidates no development key names, in hash order, spread over the strata. */
export function sampleGapStories(candidates: GapCandidate[], excluded: ReadonlySet<string>, size: number = GAP_SAMPLE_SIZE) {
  const pool = byEvalHash(
    candidates.filter(c => !excluded.has(c.slug)),
    c => c.id,
  )
  return stratifiedPick(pool, { total: size, quotas: [], spreadBy: stratumOf })
}

// ---------------------------------------------------------------------------
// Drafting
// ---------------------------------------------------------------------------

export interface DraftStory {
  slug: string
  input: ContextInput
}

export const draftPrompt = (input: ContextInput): string =>
  buildGapDraftPrompt({ story: storyTextOf(input), facts: input.sources.flatMap(s => s.facts.map(f => ({ id: f.id, statement: f.statement }))) })

/** The answer as a gap key, under the story's own slug, published title and UTC day. */
export const draftKey = (story: DraftStory, answer: GapDraftAnswer) => ({
  schemaVersion: 1,
  slug: story.slug,
  title: story.input.title,
  date: story.input.storyDay,
  needs: answer.needs,
  notNeeded: answer.notNeeded,
  notes: answer.notes,
})

export interface GapDraft {
  slug: string
  outcome: CallOutcome
  /** The draft key, null when the call gave none. */
  key: ReturnType<typeof draftKey> | null
  /** The format's errors (`parseGapKey`), for the check to fix; or why there is no draft. */
  errors: string[]
}

export const plannedDraftCalls = (stories: DraftStory[]): PlannedCall[] =>
  stories.map(s => ({ arm: DRAFT_ARM, schemaName: DRAFT_SCHEMA, prompt: draftPrompt(s.input), baseOutputTokens: DRAFT_OUTPUT_TOKENS }))

export async function draftGapKeys(ctx: SuiteContext, stories: DraftStory[]): Promise<GapDraft[]> {
  return Promise.all(
    stories.map(async (s): Promise<GapDraft> => {
      const rec = await ctx.call(DRAFT_ARM, DRAFT_SCHEMA, gapDraftSchema, draftPrompt(s.input))
      if (rec.outcome !== 'ok' || !rec.parsed) return { slug: s.slug, outcome: rec.outcome, key: null, errors: [`no draft: ${rec.outcome}`] }
      const key = draftKey(s, rec.parsed)
      return { slug: s.slug, outcome: rec.outcome, key, errors: parseGapKey(key).errors }
    }),
  )
}

/** Each draft with a key as `<dir>/<slug>.json`, in the committed keys' layout; no folder when there is none. */
export function writeDrafts(dir: string, drafts: GapDraft[]): string[] {
  const keyed = drafts.filter(d => d.key)
  if (keyed.length > 0) mkdirSync(dir, { recursive: true })
  return keyed.map(d => {
    const file = join(dir, `${d.slug}.json`)
    writeFileSync(file, `${JSON.stringify(d.key, null, 2)}\n`)
    return file
  })
}

// ---------------------------------------------------------------------------
// The step
// ---------------------------------------------------------------------------

interface GapSample {
  version: typeof GAP_SAMPLE_VERSION
  createdAt: string
  anchor: string | null
  candidates: number
  picked: GapCandidate[]
  shortfalls: string[]
}

export interface GapDraftStepOptions {
  ctx: SuiteContext & Ledger
  /** `.cache/gap-sample.json`. */
  sampleFile: string
  /** Sample again (`--refresh-fixtures`). */
  refresh: boolean
  loadCandidates(): Promise<{ anchor: string | null; candidates: GapCandidate[] }>
  developmentKeys: KeyFile[]
  inputs(slugs: string[]): Promise<Map<string, ContextInput | null>>
  /** `--out/gap-drafts`. */
  draftDir: string
  limit?: number
  dryRun: boolean
  gate: CallGate
  now?: Date
}

export interface GapDraftReport {
  createdAt: string
  anchor: string | null
  candidates: number
  sample: (Pick<GapCandidate, 'slug' | 'issue' | 'figures'> & { stratum: string })[]
  shortfalls: string[]
  /** Sampled stories production's loader gave no input for. */
  noInput: string[]
  estimate: CallEstimate
  /** Why the calls did not run (the budget or the API key), or null. */
  stopped: string | null
  drafts: GapDraft[]
  written: string[]
}

/** The cached sample, unless `--refresh-fixtures` or another version asks for a new one. */
async function sampleOf(o: GapDraftStepOptions): Promise<GapSample> {
  if (!o.refresh && existsSync(o.sampleFile)) {
    const cached = JSON.parse(readFileSync(o.sampleFile, 'utf8')) as Partial<GapSample>
    if (cached.version === GAP_SAMPLE_VERSION) return cached as GapSample
  }
  const { anchor, candidates } = await o.loadCandidates()
  const { picked, shortfalls } = sampleGapStories(candidates, developmentSlugs(o.developmentKeys))
  const sample: GapSample = {
    version: GAP_SAMPLE_VERSION,
    createdAt: (o.now ?? new Date()).toISOString(),
    anchor,
    candidates: candidates.length,
    picked,
    shortfalls,
  }
  mkdirSync(dirname(o.sampleFile), { recursive: true })
  writeFileSync(o.sampleFile, JSON.stringify(sample, null, 1))
  return sample
}

/** The step: the sample, its stories' inputs, then the drafts when their calls fit the budget. */
export async function runGapDraftStep(o: GapDraftStepOptions): Promise<GapDraftReport> {
  const sample = await sampleOf(o)
  const picked = o.limit === undefined ? sample.picked : sample.picked.slice(0, o.limit)
  const inputs = picked.length === 0 ? new Map<string, ContextInput | null>() : await o.inputs(picked.map(p => p.slug))
  const stories = picked.flatMap(p => {
    const input = inputs.get(p.slug)
    return input ? [{ slug: p.slug, input }] : []
  })
  const estimate = estimateCalls(o.ctx, plannedDraftCalls(stories))
  const stopped = o.dryRun ? null : refusal(estimate, o.ctx, o.gate)
  const drafts = o.dryRun || stopped ? [] : await draftGapKeys(o.ctx, stories)
  return {
    createdAt: sample.createdAt,
    anchor: sample.anchor,
    candidates: sample.candidates,
    sample: sample.picked.map(p => ({ slug: p.slug, issue: p.issue, figures: p.figures, stratum: stratumOf(p) })),
    shortfalls: sample.shortfalls,
    noInput: picked.filter(p => !inputs.get(p.slug)).map(p => p.slug),
    estimate,
    stopped,
    drafts,
    written: writeDrafts(o.draftDir, drafts),
  }
}

/**
 * One research pass's steps on one story (`.context/research-passes.md`, "The steps"), first and
 * later: own sources, coverage queries, search and extraction (research's; a later pass takes the
 * confirmation and queries from its last pass's plan while their prompts are the same, and the
 * extraction gives each fact its structured fields), the structure call for a fact without them, the
 * gap list and its searches (context's, `researchPassCards.ts`), one fact check of each fact not
 * judged before (its figure judged against its source first, `checkFacts`), the article (a first pass's from the supported facts with research's checks, repair
 * and gate; a later pass's update, `researchPassLater.ts`), then the cards from the pool with context's
 * write and box check. It reads and returns the story's evidence pool (`researchPassPool.ts`): what the
 * pool holds is not searched, read or checked again. No I/O of its own, like `researchStory`: the
 * metered call (`researchPassSteps.ts`), the searches and the opt-out policy are injected, so the eval
 * runs the same code. A card-stage failure never fails the pass; a budget skip before the cards ends
 * it as research's `fallback: budget` does. It writes nothing (`passRecords.ts` stores the result).
 */
import { config } from '../config.js'
import { TAVILY_DEPTH } from '../lib/tavily.js'
import { articleOf, nextVersion } from './articleVersions.js'
import { decideGate, type GateVerdict } from './researchChecks.js'
import { buildResearchedStory } from './researchedStory.js'
import type { SourcePolicy } from './researchFilter.js'
import type { ResearchStory } from './researchInput.js'
import { gapStep, writeCards } from './researchPassCards.js'
import { updateArticle, type UpdateOutcome } from './researchPassLater.js'
import { coverageSearches, knownPages, laterStory, laterWindow, planSteps, type CoveragePlan } from './researchPassPlan.js'
import { WorkingPool, type OfferedFact } from './researchPassPool.js'
import { passCalls, type PassOutcome, type PassRecord } from './researchPassRecord.js'
import { passCaller, type PassCall, type PassCaller } from './researchPassSteps.js'
import {
  BudgetExhaustedError,
  emptyResearch,
  extractCoverage,
  fallbackOf,
  recordingCall,
  runPassArticle,
  type Coverage,
  type ResearchDeps,
  type StepCaller,
  type StoryResearch,
} from './researchPipeline.js'
import { asResearchEarlier, asResearchSource, contextFact, usable, type ArticleVersionData, type Pool, type PoolFact } from './researchPool.js'
import { researchedValues } from './researchSwap.js'
import type { ContextFactData, DraftBox } from './storyContextChecks.js'
import { FIGURELESS } from './storyContextFigures.js'
import type { StoryLayout } from './storyContextLayout.js'
import {
  checkFacts,
  CONTEXT_PROMPT_VERSIONS,
  contextFailure,
  emptyContextRecord,
  stepCaller,
  type ContextDeps,
  type ContextRunRecord,
  type GapStageResult,
} from './storyContextPipeline.js'
import { normalizedQuery } from './storyContextSources.js'

// ---------------------------------------------------------------------------
// Input, deps and result
// ---------------------------------------------------------------------------

export interface PassDeps {
  call: PassCall
  /** Research's coverage search (advanced, news). */
  tavily: ResearchDeps['tavily']
  /** Context's gap search (basic, with its cache in production). */
  search: ContextDeps['search']
  admit?: ResearchDeps['admit']
  sourcePolicy?: SourcePolicy
  transient?(err: unknown): boolean
  /** Publish bar for the gate (`config.selection.relevanceMin`). */
  relevanceMin: number
  /** Caps the coverage window's end (the eval's sampling time). */
  latestDate?: string
}

export interface PassInput {
  /** The pass's row, which every row the pass adds names as its provenance. */
  passId: string
  story: ResearchStory
  pool: Pool
  /** The story's current article version: none for a first pass. */
  version: ArticleVersionData | null
  /** `YYYY-MM-DD`: the day of the story's last pass or legacy research run, where a later pass's coverage window opens; null for none. */
  lastPassDay: string | null
  /**
   * The earlier later passes whose facts the article never took a judgment on (`loadPassInput`): a
   * later pass judges their facts as its own, beside the ones it finds.
   */
  carried: string[]
  /** The coverage plan the story's last pass kept (`loadPassInput`), which a later pass takes step by step while each prompt is the same; null for none. */
  plan: CoveragePlan | null
  /** `YYYY-MM-DD`: the pass's day, where a later pass's window ends. */
  today: string
  /** The story as readers see it before the pass, which the gap list reads. */
  current: { title: string; summary: string; layout: StoryLayout }
  /** `YYYY-MM-DD`: facts are judged current on it. */
  storyDay: string
  /** Facts of the earlier stories research may link, offered only for those the pass links. */
  reusable: OfferedFact[]
}

export interface PassResult {
  kind: 'first' | 'later'
  /** `failed` for a technical failure, which may be tried again when `transient`. */
  status: 'completed' | 'failed'
  outcome: PassOutcome
  verdict: GateVerdict
  /** The pool after the pass: new sources and facts have no id; searches name this pass. */
  pool: Pool
  /** Stored facts whose judgment this pass changed. */
  changed: string[]
  /** Version 1 of a first pass whose draft was kept, or a later pass's update. */
  version: ArticleVersionData | null
  boxes: DraftBox[]
  boxFacts: Map<string, ContextFactData>
  writer: { model: string; promptVersion: string } | null
  record: PassRecord
  credits: number
  modelUsd: number
  /** Why the pass failed, safe to store. */
  error: string | null
  transient: boolean
}

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

const outcomeOf = (verdict: GateVerdict): PassOutcome =>
  verdict.kind === 'keep'
    ? 'written'
    : verdict.kind !== 'fallback'
      ? verdict.kind
      : isBudgetFallback(verdict)
        ? 'budget'
        : verdict.category === 'technical'
          ? 'technical'
          : 'fallback'

/** Research's budget fallback: its stop's reason, a technical category. */
const isBudgetFallback = (verdict: GateVerdict) => verdict.kind === 'fallback' && verdict.reason === 'budget'

/** A kept draft as version 1: the columns an apply writes, and the reader projection. */
function firstVersion(r: StoryResearch, passId: string): ArticleVersionData | null {
  if (!r.draft) return null
  const values = researchedValues(r.draft)
  return {
    id: null,
    number: 1,
    kind: 'first',
    status: 'current',
    passId,
    title: values.title,
    titleLabel: values.titleLabel,
    summary: values.summary,
    marketingBlurb: values.marketingBlurb,
    quote: values.quote,
    quoteAttribution: values.quoteAttribution,
    relevanceReasons: values.relevanceReasons,
    antifactors: values.antifactors,
    emotionTag: values.emotionTag ?? null,
    research: buildResearchedStory({ draft: r.draft, sources: r.sources, earlier: r.earlier }),
    article: articleOf(r.draft),
    changes: [],
    note: null,
  }
}

/** Runs one pass. Never throws: a failure is a `technical` outcome with its error. */
export async function runResearchPass(input: PassInput, deps: PassDeps): Promise<PassResult> {
  const optOutChecked = deps.sourcePolicy !== undefined
  const r = emptyResearch(input.story.id, optOutChecked)
  const context = emptyContextRecord(optOutChecked)
  const record: PassRecord = {
    research: r,
    context,
    cards: 'none',
    cardsError: null,
    skippedQueries: [],
    plan: { confirm: null, queries: null, use: input.story.neighbours.length === 0 ? { confirm: 'no neighbours' } : {} },
    update: null,
  }
  const pool = new WorkingPool(input.pool, input.passId)
  const spent = { credits: 0 }
  let coverageWindow: Coverage['window'] | null = null
  const finish = (over: Partial<PassResult>): PassResult => {
    const verdict = over.verdict ?? r.verdict
    return {
      kind: input.version ? 'later' : 'first',
      status: 'completed',
      outcome: outcomeOf(verdict),
      verdict,
      pool: pool.result(searchesOf(r, context, input.passId, coverageWindow), droppedOf(context, input.passId)),
      changed: [...pool.changed],
      version: null,
      boxes: [],
      boxFacts: new Map(),
      writer: null,
      record,
      credits: r.credits + spent.credits,
      // Every call the pass made, a later pass's judge, rewrite and note among them
      modelUsd: passCalls(record).reduce((sum, c) => sum + c.costUsd, 0),
      error: null,
      transient: false,
      ...over,
    }
  }
  // A later pass searches what other outlets reported since the last pass, and links only our stories new since
  const since = input.version ? laterWindow(input.lastPassDay ?? input.storyDay, input.today, deps.latestDate) : null

  // Every call goes through the one metered caller, recorded where its part of the pass records them
  const caller = passCaller(deps.call)
  const call = recordingCall(caller.research, r)
  const cardCall = stepCaller(caller.cards, context.calls)
  const budgetStop = (): PassResult => {
    r.verdict = decideGate({ failed: 'budget', category: 'technical' }, deps.relevanceMin)
    return finish({})
  }
  const isBudget = (err: unknown) => caller.budget || err instanceof BudgetExhaustedError

  // Steps 1-3: own sources, coverage queries (those made before skipped), search, filter, extraction
  let coverage: Coverage | null = null
  let stop: ReturnType<typeof fallbackOf> | null = null
  try {
    coverage = await extractCoverage(since ? laterStory(input.story, input.pool, since) : input.story, deps, call, r, {
      known: knownPages(input.pool),
      pickQueries: (queries, window) => {
        const picked = coverageSearches(queries, input.pool, window)
        record.skippedQueries = picked.skipped.map(q => q.query)
        return picked.search
      },
      ...(since ? { since } : {}),
      structured: true,
      // A later pass takes the last pass's confirmation and queries while their prompts are the same
      plan: planSteps(record.plan, input.plan, since === null),
    })
    coverageWindow = coverage.window
  } catch (err) {
    stop = fallbackOf(err)
  }
  pool.admitCoverage(r, r.calls.find(c => c.step === 'extract')?.model ?? 'unknown')
  if (stop?.failed === 'budget') return budgetStop()

  // Steps 4-6: the structure call, the gap list and its searches. A story with no research facts
  // gets no cards, as context's rule has it; a technical failure leaves the article its coverage
  // and fails only the cards
  let gap: GapStageResult | null = null
  if (pool.pages().some(s => pool.factsOf(s).length > 0)) {
    try {
      gap = await gapStep({ input, pool, deps, call: cardCall, context, spent, optOutChecked })
    } catch (err) {
      if (isBudget(err)) return budgetStop()
      record.cards = 'failed'
      record.cardsError = contextFailure(err, deps.transient).error
    }
  }

  // Step 7: one fact check of each fact no pass or run judged, after the figure check: our earlier
  // stories' are our own text. A failed call of either, a budget skip among them, writes nothing
  try {
    const unjudged = pool.pages().flatMap(s => pool.factsOf(s, f => f.verdict === 'unjudged').map(f => contextFact(f, s)))
    if (unjudged.length > 0) {
      const checked = await checkFacts(unjudged, cardCall, context)
      const checkedBy = {
        model: [...context.calls].reverse().find(c => c.step === 'fact-check')?.model ?? 'unknown',
        promptVersion: CONTEXT_PROMPT_VERSIONS['fact-check'],
        passId: input.passId,
      }
      storeJudged(pool, checked, context, checkedBy)
    }
  } catch (err) {
    if (isBudget(err)) return budgetStop()
    const failure = contextFailure(err, deps.transient)
    record.cards = 'failed'
    record.cardsError = failure.error
    r.verdict = decideGate({ failed: `facts-check: ${failure.error}`, category: 'technical' }, deps.relevanceMin)
    return finish({ status: 'failed', error: failure.error, transient: failure.transient })
  }

  r.sources = pool.pages().map(s => asResearchSource(s, pool.factsOf(s)))
  r.earlier = pool.sources.filter(s => s.origin === 'earlier').map(s => asResearchEarlier(s, pool.factsOf(s)))
  let version: ArticleVersionData | null
  let outcome: PassOutcome | undefined
  if (input.version) {
    // Step 8, a later pass. A pass whose coverage stopped short goes on with what it found, the stop recorded
    if (stop) r.verdict = decideGate(stop, deps.relevanceMin)
    const later = await laterArticle({ ...input, version: input.version }, pool, { caller, call, transient: deps.transient }, record)
    if (later.ends === 'budget') return budgetStop()
    // The cards stay as they are
    if (later.ends === 'failed') {
      record.cards = 'kept'
      return finish({ status: 'failed', outcome: 'technical', error: later.error, transient: later.transient })
    }
    outcome = later.outcome
    version = later.version
    if (!later.cards) {
      record.cards = 'kept'
      return finish({ outcome, version })
    }
  } else {
    // Step 8: the article from the supported facts and our earlier stories' facts, checked against every source
    if (coverage && !stop) {
      const sources = pool.pages().map(s => asResearchSource(s, pool.factsOf(s, usable)))
      await runPassArticle({ story: input.story, coverage, sources, earlier: r.earlier }, deps.relevanceMin, call, r)
    } else {
      r.verdict = decideGate(stop ?? { failed: 'no coverage', category: 'technical' }, deps.relevanceMin)
    }
    if (isBudgetFallback(r.verdict)) return budgetStop()
    // A draft rated below the publish bar is kept as research's step keeps it: that rating rejects nothing
    version = r.verdict.kind === 'keep' || r.verdict.kind === 'research-rating' ? firstVersion(r, input.passId) : null
  }

  // Step 9: the cards from the pool's supported facts, never our own stories', for the new version's
  // places when the pass made one; they never fail the pass
  const settled = { version, ...(outcome ? { outcome } : {}) }
  const cards = await writeCards(input, pool, gap, version, cardCall, context)
  if (cards.kind === 'error') {
    record.cards = isBudget(cards.err) ? 'budget' : 'failed'
    record.cardsError = record.cards === 'failed' ? contextFailure(cards.err, deps.transient).error : null
    return finish(settled)
  }
  if (cards.kind === 'skipped') return finish(settled)
  record.cards = cards.boxes.length > 0 ? 'written' : 'none'
  return finish({ ...settled, boxes: cards.boxes, boxFacts: cards.facts, writer: cards.writer })
}

/**
 * Step 7's writes to the pool: each fact the check judged gets its verdict and, when the figure check
 * removed its figure, its stored fields without it in the same update (`FIGURELESS`; who structured
 * it kept). A fact left unjudged is written nothing: it keeps its figure and is judged again by the
 * next pass, figure and all, so its removal is taken out of the record, which lists only those stored.
 */
function storeJudged(pool: WorkingPool, checked: ContextFactData[], context: ContextRunRecord, checkedBy: NonNullable<PoolFact['checkedBy']>): void {
  const judged = checked.filter(f => f.verdict !== 'unjudged')
  const refs = new Set(judged.map(f => f.ref))
  context.removedFigures = context.removedFigures.filter(r => refs.has(r.ref))
  const removed = new Set(context.removedFigures.map(r => r.ref))
  for (const f of judged) {
    const stored = pool.facts.find(p => p.ref === f.ref)?.structured
    const figureless = removed.has(f.ref) && stored ? { structured: { ...stored, ...FIGURELESS } } : {}
    pool.update(f.ref, { verdict: f.verdict, verdictProblem: f.verdictProblem, checkedBy, ...figureless })
  }
}

/** A later pass's outcome from its article step's (a budget stop and a technical failure end the pass before this). */
const LATER_OUTCOMES: Record<Exclude<UpdateOutcome, 'budget' | 'technical'>, PassOutcome> = {
  updated: 'updated',
  unchanged: 'unchanged',
  update_failed: 'update_failed',
}

/** How a later pass's article step ended: the budget stopped it, a call failed (`transient`: it may pass), or it settled the article, with whether the cards are written again. */
type LaterArticle =
  | { ends: 'budget' }
  | { ends: 'failed'; error: string | null; transient: boolean }
  | { ends: 'settled'; outcome: PassOutcome; version: ArticleVersionData | null; cards: boolean }

/**
 * Step 8 of a later pass: the judge of each section against the facts found since the article last
 * took a judgment (this pass's, and those of the earlier passes it carries), the demotions, the
 * rewrite of what they make wrong or substantially different, and the note (`updateArticle`). Its
 * record goes on the pass's, and the facts it demotes are demoted in the pool. The cards are written
 * again only when the pool gained a supported fact or lost one.
 */
async function laterArticle(
  input: PassInput & { version: ArticleVersionData },
  pool: WorkingPool,
  calls: { caller: PassCaller; call: StepCaller; transient: PassDeps['transient'] },
  record: PassRecord,
): Promise<LaterArticle> {
  const { caller } = calls
  const own = new Set([input.passId, ...input.carried])
  const fresh = new Set(pool.facts.filter(f => f.firstPassId !== null && own.has(f.firstPassId)).map(f => f.ref))
  // A technical failure is that of a call the article step makes, or an error thrown in its rewrite
  caller.forgetFailure()
  const update = await updateArticle(
    { storyDay: input.storyDay, version: input.version, pool, fresh },
    { call: caller.later, research: calls.call, ...(calls.transient ? { transient: calls.transient } : {}) },
  )
  record.update = update.record
  for (const d of update.demoted)
    pool.update(d.ref, { status: 'demoted', drop: { passId: input.passId, reason: 'contradicted', contradictedBy: d.contradictedBy } })
  if (update.outcome === 'budget') return { ends: 'budget' }
  // A failed call fails the pass, so it is tried again where the failure may pass and counts in the failure share
  if (update.outcome === 'technical') return { ends: 'failed', error: update.record.error, transient: update.transient ?? caller.lastTransient }
  const version = update.next ? nextVersion(input.version, { passId: input.passId, ...update.next }) : null
  const gained = pool.facts.some(f => fresh.has(f.ref) && f.verdict === 'supported' && pool.sourceOf(f).origin !== 'earlier')
  return { ends: 'settled', outcome: LATER_OUTCOMES[update.outcome], version, cards: gained || update.demoted.length > 0 }
}

/** The searches this pass made: research's coverage searches in its window, context's gap searches. */
function searchesOf(r: StoryResearch, context: ContextRunRecord, passId: string, window: Coverage['window'] | null): Pool['searches'] {
  return [
    ...r.searches.map(s => ({
      kind: 'coverage' as const,
      slot: null,
      angle: null,
      query: s.query,
      normalizedQuery: normalizedQuery(s.query),
      windowStart: window?.start ?? null,
      windowEnd: window?.end ?? null,
      depth: TAVILY_DEPTH,
      credits: s.credits,
      results: s.results,
      cached: s.cached,
      passId,
    })),
    ...context.searches.map(s => ({
      kind: 'gap' as const,
      slot: s.slot,
      angle: s.angle ?? null,
      query: s.query,
      normalizedQuery: normalizedQuery(s.query),
      windowStart: null,
      windowEnd: null,
      depth: config.storyContext.searchDepth,
      credits: s.credits,
      results: s.results,
      cached: s.cached,
      passId,
    })),
  ]
}

/** The pages the gap searches read and left out, never read again. */
const droppedOf = (context: ContextRunRecord, passId: string): Pool['dropped'] => context.extractionDrops.map(d => ({ url: d.url, reason: d.reason, passId }))

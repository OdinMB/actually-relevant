/**
 * One research pass's steps on one story (`.context/research-passes.md`, "The steps"), first passes
 * in this phase: own sources, coverage queries, search and extraction (research's), the structure
 * call, the gap list and its searches (context's), one fact check of each fact not judged before,
 * the article from the supported facts with research's checks, repair and gate, then the cards from
 * the pool with context's write and box check. It reads and returns the story's evidence pool: what
 * the pool holds is not searched, read or checked again. No I/O of its own, like `researchStory`:
 * the metered call, the searches and the opt-out policy are injected, so the eval runs the same code.
 * A card-stage failure never fails the pass; a budget skip before the cards ends it as research's
 * `fallback: budget` does. It writes nothing (`passRecords.ts` stores the result).
 */
import type { z } from 'zod'
import { config } from '../config.js'
import { TAVILY_DEPTH } from '../lib/tavily.js'
import type { StoryText } from '../prompts/storyContext.js'
import { decideGate, draftItems, publishedDay, type GateVerdict } from './researchChecks.js'
import type { ResearchStory } from './researchInput.js'
import {
  BudgetExhaustedError,
  emptyResearch,
  extractCoverage,
  fallbackOf,
  recordingCall,
  runPassArticle,
  STEP_TIERS,
  STEPS,
  type Coverage,
  type ResearchCall,
  type ResearchDeps,
  type StepResult,
  type StoryResearch,
} from './researchPipeline.js'
import { LATER_STEP_TIERS, LATER_STEPS, updateArticle, type LaterCall, type UpdateOutcome, type UpdateRecord } from './researchPassLater.js'
import { coverageSearches, gapSearches, knownPages, laterStory, laterWindow, readPages } from './researchPassPlan.js'
import { unescapeXmlDeep } from '../lib/xml.js'
import { articleOf, nextVersion } from './articleVersions.js'
import {
  asResearchEarlier,
  asResearchSource,
  contextFact,
  nextFactRef,
  nextSourceRef,
  poolFactKey,
  sourceKey,
  usable,
  type ArticleVersionData,
  type Pool,
  type PoolFact,
  type PoolSource,
} from './researchPool.js'
import { buildResearchedStory } from './researchedStory.js'
import type { SourcePolicy } from './researchFilter.js'
import { researchedValues } from './researchSwap.js'
import type { ContextFactData, DraftBox } from './storyContextChecks.js'
import { storyLayout, type StoryLayout } from './storyContextLayout.js'
import {
  checkFacts,
  CONTEXT_PROMPT_VERSIONS,
  CONTEXT_STEP_TIERS,
  contextFailure,
  emptyContextRecord,
  gapStage,
  responseNotFound,
  stepCaller,
  structureFacts,
  writeBoxes,
  type ContextCall,
  type ContextDeps,
  type ContextRunRecord,
  type ContextStep,
  type GapStageResult,
  type ReusableFact,
} from './storyContextPipeline.js'
import { boxRefs } from './storyContextRecords.js'
import { normalizedQuery } from './storyContextSources.js'

// ---------------------------------------------------------------------------
// Steps and their tiers
// ---------------------------------------------------------------------------

/** Context's steps as a pass names them, apart from research's steps of the same name. */
export const CARD_STEPS = {
  structure: 'structure',
  'gap-list': 'gap-list',
  'gap-extract': 'extract',
  'facts-check': 'fact-check',
  'cards-write': 'write',
  'box-check': 'box-check',
} as const satisfies Record<string, ContextStep>

export type CardStep = keyof typeof CARD_STEPS

/** Research's steps, context's under their pass names, and the later pass's judge, update and note. */
export const PASS_STEPS = [...STEPS, ...(Object.keys(CARD_STEPS) as CardStep[]), ...LATER_STEPS] as const
export type PassStep = (typeof PASS_STEPS)[number]

const CARD_STEP_OF = Object.fromEntries(Object.entries(CARD_STEPS).map(([pass, step]) => [step, pass])) as Record<ContextStep, CardStep>

/** The tier each step starts on: research's and context's as they are, the later pass's medium; the eval moves a step up. */
export const PASS_STEP_TIERS: Record<PassStep, 'small' | 'medium'> = {
  ...STEP_TIERS,
  ...(Object.fromEntries(Object.entries(CARD_STEPS).map(([pass, step]) => [pass, CONTEXT_STEP_TIERS[step]])) as Record<CardStep, 'small' | 'medium'>),
  ...LATER_STEP_TIERS,
}

// ---------------------------------------------------------------------------
// Input, deps and result
// ---------------------------------------------------------------------------

/** One metered structured-output call for a step; a `skipped` outcome means the budget is used up. */
export type PassCall = <T>(step: PassStep, schema: z.ZodType<T>, prompt: string) => Promise<StepResult<T> & { transient?: boolean }>

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

/** A linked earlier story's supported, current fact, which the cards may cite (context's step 1). */
export interface OfferedFact {
  storyId: string
  fact: ReusableFact
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
  /** `YYYY-MM-DD`: the pass's day, where a later pass's window ends. */
  today: string
  /** The story as readers see it before the pass, which the gap list reads. */
  current: { title: string; summary: string; layout: StoryLayout }
  /** `YYYY-MM-DD`: facts are judged current on it. */
  storyDay: string
  /** Facts of the earlier stories research may link, offered only for those the pass links. */
  reusable: OfferedFact[]
}

/** What became of the cards: written, nothing kept, a technical failure, the budget stopped them, or kept as they were (a later pass whose pool gained no supported fact and lost none). */
export type CardsOutcome = 'written' | 'none' | 'failed' | 'budget' | 'kept'

/** A first pass's gate outcome; a later pass's `updated`, `unchanged` or `update_failed`; either's `budget` or `technical`. */
export type PassOutcome =
  'written' | 'stale' | 'contradicted' | 'research-rating' | 'fallback' | 'budget' | 'technical' | 'updated' | 'unchanged' | 'update_failed'

/** Everything else the pass did, stored as `research_passes.record`. */
export interface PassRecord {
  /** The article's steps, as research records them. */
  research: StoryResearch
  /** The card steps, as context records them. */
  context: ContextRunRecord
  cards: CardsOutcome
  /** Why the cards failed, safe to store. */
  cardsError: string | null
  /** Coverage queries not searched: an earlier pass made them. */
  skippedQueries: string[]
  /** A later pass's article step: the judgments, demotions, checks and note (`researchPassLater.ts`); null on a first pass. */
  update: UpdateRecord | null
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
// The pool as the pass works on it
// ---------------------------------------------------------------------------

/** The pass's working copy of the pool, with the refs it adds and the stored facts it changes. */
class WorkingPool {
  readonly sources: PoolSource[]
  readonly facts: PoolFact[]
  readonly changed = new Set<string>()
  /** Each fact's key and the ref the pool holds it under. */
  private readonly keys = new Map<string, string>()

  constructor(
    private readonly pool: Pool,
    private readonly passId: string,
  ) {
    this.sources = pool.sources.map(s => ({ ...s }))
    this.facts = pool.facts.map(f => ({ ...f }))
    for (const f of this.facts) {
      const key = poolFactKey(f, this.sourceOf(f))
      if (!this.keys.has(key)) this.keys.set(key, f.ref)
    }
  }

  /** Whether the pool holds a fact of this key (`poolFactKey`). */
  holds(key: string): boolean {
    return this.keys.has(key)
  }

  sourceOf(f: Pick<PoolFact, 'sourceRef'>): PoolSource {
    return this.sources.find(s => s.ref === f.sourceRef)!
  }

  /** The pool's source for this page or earlier story, added under the next free ref when new. */
  source(s: Omit<PoolSource, 'id' | 'ref' | 'firstPassId'>, ref?: string): PoolSource {
    const key = sourceKey(s)
    const known = this.sources.find(x => sourceKey(x) === key)
    if (known) return known
    const taken = this.sources.map(x => x.ref)
    const added: PoolSource = {
      ...s,
      id: null,
      ref: ref && !taken.includes(ref) ? ref : nextSourceRef(taken, s.origin === 'earlier'),
      firstPassId: this.passId,
    }
    this.sources.push(added)
    return added
  }

  /** A fact of a pool source, added unless the pool holds it already by key; its ref in the pool either way. */
  add(source: PoolSource, f: Omit<PoolFact, 'id' | 'ref' | 'sourceRef' | 'firstPassId' | 'checkedBy' | 'status' | 'drop'>): string {
    const key = poolFactKey(f, source)
    const known = this.keys.get(key)
    if (known !== undefined) return known
    const ref = nextFactRef(
      source.ref,
      this.facts.map(x => x.ref),
    )
    this.keys.set(key, ref)
    this.facts.push({ ...f, id: null, ref, sourceRef: source.ref, firstPassId: this.passId, checkedBy: null, status: 'unreviewed', drop: null })
    return ref
  }

  update(ref: string, change: Partial<PoolFact>): void {
    const f = this.facts.find(x => x.ref === ref)
    if (!f) return
    Object.assign(f, change)
    if (f.id !== null) this.changed.add(ref)
  }

  /** A page's or an earlier story's facts, as given. */
  factsOf(s: PoolSource, keep: (f: PoolFact) => boolean = () => true): PoolFact[] {
    return this.facts.filter(f => f.sourceRef === s.ref && keep(f))
  }

  result(searches: Pool['searches'], dropped: Pool['dropped']): Pool {
    return { sources: this.sources, facts: this.facts, searches: [...this.pool.searches, ...searches], dropped: [...this.pool.dropped, ...dropped] }
  }
}

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

/** Research's coverage, as the pool takes it: each source once by its page, each fact once by its key. */
function addCoverage(pool: WorkingPool, r: StoryResearch, extractModel: string): void {
  const extractedBy = { model: extractModel, promptVersion: RESEARCH_EXTRACT_VERSION }
  for (const s of r.sources) {
    const source = pool.source(
      {
        origin: s.origin,
        earlierStoryId: null,
        url: s.url,
        outlet: s.outlet,
        title: s.title,
        date: publishedDay(s.date),
        kind: s.kind,
        country: s.country,
        relation: s.relation,
        favicon: s.favicon,
        usedRawContent: s.usedRawContent,
        voices: s.voices,
        optOutChecked: r.optOutChecked,
      },
      s.id,
    )
    for (const f of s.facts) pool.add(source, { ...fact(f), extractedBy })
  }
  for (const e of r.earlier) {
    const source = pool.source(
      {
        origin: 'earlier',
        earlierStoryId: e.storyId,
        url: '',
        outlet: 'Actually Relevant',
        title: e.title,
        date: e.date || null,
        kind: '',
        country: '',
        relation: e.relation,
        favicon: null,
        usedRawContent: false,
        voices: [],
        optOutChecked: false,
      },
      e.id,
    )
    for (const f of e.facts) pool.add(source, { ...fact(f), extractedBy })
  }
}

const fact = (f: { statement: string; supportingSentence: string; measures: string; found: boolean }) => ({
  reusedFromId: null,
  supportingSentence: f.supportingSentence,
  passage: null,
  supportFound: f.found,
  statement: f.statement,
  measures: f.measures,
  slot: null,
  structured: null,
  verdict: 'unjudged' as const,
  verdictProblem: null,
})

/** Research's extraction prompt is not versioned: its facts carry this, and their model. */
export const RESEARCH_EXTRACT_VERSION = 'research-extract'

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

/** The text the gap list and the cards read: the title and the layout's items. */
function storyText(title: string, storyDay: string, layout: StoryLayout): { story: StoryText; text: string } {
  return {
    story: { title, date: storyDay, paragraphs: layout.paragraphs, points: layout.points, caveats: layout.caveats },
    text: [title, ...layout.paragraphs.map(p => p.text), ...layout.points.map(p => p.text), ...layout.caveats].join('\n'),
  }
}

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
  const record: PassRecord = { research: r, context, cards: 'none', cardsError: null, skippedQueries: [], update: null }
  const pool = new WorkingPool(input.pool, input.passId)
  const spent = { credits: 0 }
  let budget = false
  // Whether the last call that failed may pass on a second attempt: a later pass's technical failure is that call's
  const lastFailure = { transient: false }
  const noted = <R extends { outcome: string; transient?: boolean }>(res: R): R => {
    if (res.outcome === 'skipped') budget = true
    else if (res.outcome !== 'ok') lastFailure.transient = res.transient === true
    return res
  }
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
  let coverageWindow: Coverage['window'] | null = null
  // A later pass searches what other outlets reported since the last pass, and links only our stories new since
  const since = input.version ? laterWindow(input.lastPassDay ?? input.storyDay, input.today, deps.latestDate) : null

  const researchCall: ResearchCall = async (step, schema, prompt) => noted(await deps.call(step, schema, prompt))
  const call = recordingCall(researchCall, r)
  const cardCall = stepCaller((async (step, schema, prompt) => noted(await deps.call(CARD_STEP_OF[step], schema, prompt))) as ContextCall, context.calls)
  const budgetStop = (): PassResult => {
    r.verdict = decideGate({ failed: 'budget', category: 'technical' }, deps.relevanceMin)
    return finish({})
  }
  const isBudget = (err: unknown) => budget || err instanceof BudgetExhaustedError

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
    })
    coverageWindow = coverage.window
  } catch (err) {
    stop = fallbackOf(err)
  }
  addCoverage(pool, r, r.calls.find(c => c.step === 'extract')?.model ?? 'unknown')
  if (stop?.failed === 'budget') return budgetStop()

  // Steps 4-6: the structure call, the gap list and its searches. A story with no research facts
  // gets no cards, as context's rule has it; a technical failure leaves the article its coverage
  // and fails only the cards
  let gap: GapStageResult | null = null
  const pages = () => pool.sources.filter(s => s.origin !== 'earlier')
  if (pages().some(s => pool.factsOf(s).length > 0)) {
    try {
      gap = await gapStep({ input, pool, deps, call: cardCall, context, spent, optOutChecked })
    } catch (err) {
      if (isBudget(err)) return budgetStop()
      record.cards = 'failed'
      record.cardsError = contextFailure(err, deps.transient).error
    }
  }

  // Step 7: one fact check of each fact no pass or run judged: our earlier stories' are our own text
  try {
    const unjudged = pages().flatMap(s => pool.factsOf(s, f => f.verdict === 'unjudged').map(f => contextFact(f, s)))
    if (unjudged.length > 0) {
      const checked = await checkFacts(unjudged, cardCall, context)
      const checkedBy = {
        model: [...context.calls].reverse().find(c => c.step === 'fact-check')?.model ?? 'unknown',
        promptVersion: CONTEXT_PROMPT_VERSIONS['fact-check'],
        passId: input.passId,
      }
      for (const f of checked) if (f.verdict !== 'unjudged') pool.update(f.ref, { verdict: f.verdict, verdictProblem: f.verdictProblem, checkedBy })
    }
  } catch (err) {
    if (isBudget(err)) return budgetStop()
    const failure = contextFailure(err, deps.transient)
    record.cards = 'failed'
    record.cardsError = failure.error
    r.verdict = decideGate({ failed: `facts-check: ${failure.error}`, category: 'technical' }, deps.relevanceMin)
    return finish({ status: 'failed', error: failure.error, transient: failure.transient })
  }

  r.sources = pages().map(s => asResearchSource(s, pool.factsOf(s)))
  r.earlier = pool.sources.filter(s => s.origin === 'earlier').map(s => asResearchEarlier(s, pool.factsOf(s)))
  let version: ArticleVersionData | null
  let outcome: PassOutcome | undefined
  if (input.version) {
    // Step 8, a later pass: the judge of each section against the facts found since, the demotions, the
    // rewrite of what they make wrong or substantially different, and the note. A pass whose coverage
    // stopped short goes on with what it found, the stop recorded
    if (stop) r.verdict = decideGate(stop, deps.relevanceMin)
    const laterCall: LaterCall = async (step, schema, prompt) => {
      const { transient: _transient, ...res } = noted(await deps.call(step, schema, prompt))
      return { ...res, parsed: res.outcome === 'ok' ? unescapeXmlDeep(res.parsed) : null }
    }
    // The facts found since the article last took a judgment: this pass's, and those of the earlier passes it carries
    const own = new Set([input.passId, ...input.carried])
    const fresh = new Set(pool.facts.filter(f => f.firstPassId !== null && own.has(f.firstPassId)).map(f => f.ref))
    lastFailure.transient = false
    const update = await updateArticle({ storyDay: input.storyDay, version: input.version, pool, fresh }, { call: laterCall, research: call })
    record.update = update.record
    for (const d of update.demoted)
      pool.update(d.ref, { status: 'demoted', drop: { passId: input.passId, reason: 'contradicted', contradictedBy: d.contradictedBy } })
    if (update.outcome === 'budget') return budgetStop()
    // A failed call fails the pass, so it is tried again where the failure may pass and counts in the failure share;
    // the cards stay as they are
    if (update.outcome === 'technical') {
      record.cards = 'kept'
      return finish({ status: 'failed', outcome: 'technical', error: update.record.error, transient: lastFailure.transient })
    }
    outcome = LATER_OUTCOMES[update.outcome]
    version = update.next ? nextVersion(input.version, { passId: input.passId, ...update.next }) : null
    // Step 9 is skipped when the pool gained no supported fact and lost none: the cards stay as they are
    const gained = pool.facts.some(f => fresh.has(f.ref) && f.verdict === 'supported' && pool.sourceOf(f).origin !== 'earlier')
    if (!gained && update.demoted.length === 0) {
      record.cards = 'kept'
      return finish({ outcome, version })
    }
  } else {
    // Step 8: the article from the supported facts and our earlier stories' facts, checked against every source
    if (coverage && !stop) {
      const sources = pages().map(s => asResearchSource(s, pool.factsOf(s, usable)))
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

/** A later pass's outcome from its article step's (a budget stop and a technical failure end the pass before this). */
const LATER_OUTCOMES: Record<Exclude<UpdateOutcome, 'budget' | 'technical'>, PassOutcome> = {
  updated: 'updated',
  unchanged: 'unchanged',
  update_failed: 'update_failed',
}

interface GapStepInput {
  input: PassInput
  pool: WorkingPool
  deps: PassDeps
  call: ReturnType<typeof stepCaller>
  context: ContextRunRecord
  spent: { credits: number }
  optOutChecked: boolean
}

/** Steps 4-6: the structure call on the pages' facts without fields, the gap list over the pool, its searches and extraction; the new facts join the pool. Throws on a failure. */
async function gapStep({ input, pool, deps, call, context, spent, optOutChecked }: GapStepInput): Promise<GapStageResult> {
  const pages = () => pool.sources.filter(s => s.origin !== 'earlier')
  const toStructure = pages().flatMap(s => pool.factsOf(s, f => f.structured === null).map(f => ({ s, f })))
  const structure = await structureFacts(
    toStructure.map(({ s, f }) => ({
      id: f.ref,
      statement: f.statement,
      supportingSentence: f.supportingSentence,
      measures: f.measures,
      source: { outlet: s.outlet, date: s.date, kind: s.kind },
    })),
    call,
  )
  for (const [ref, answer] of structure.answers)
    pool.update(ref, { structured: { ...answer, by: { model: structure.model, promptVersion: CONTEXT_PROMPT_VERSIONS.structure } } })
  context.facts.research = toStructure.length
  context.facts.leftOut = toStructure.length - structure.answers.size

  const before = storyText(input.current.title, input.storyDay, input.current.layout)
  const gap = await gapStage(
    {
      story: before.story,
      storyText: before.text,
      title: input.current.title,
      summary: input.current.summary,
      storyDay: input.storyDay,
      facts: [
        ...pages().flatMap(s => pool.factsOf(s, f => f.structured !== null && f.verdict !== 'rejected').map(f => contextFact(f, s))),
        ...offered(input, pool),
      ],
      known: readPages({ sources: pool.sources, dropped: input.pool.dropped }),
      plan: (g, text) => gapSearches(g, text, input.pool),
      firstSource: Number(
        nextSourceRef(
          pool.sources.map(s => s.ref),
          false,
        ).slice(1),
      ),
    },
    deps,
    call,
    context,
    spent,
  )
  for (const f of gap.facts) {
    const source = pool.source(
      {
        origin: 'search',
        earlierStoryId: null,
        url: f.source.url,
        outlet: f.source.outlet,
        title: f.source.title,
        date: f.source.date,
        kind: f.source.kind,
        country: '',
        relation: 'background',
        favicon: null,
        usedRawContent: false,
        voices: [],
        optOutChecked,
      },
      f.source.id,
    )
    pool.add(source, {
      reusedFromId: null,
      supportingSentence: f.supportingSentence,
      passage: f.passage,
      supportFound: f.supportFound,
      statement: f.statement,
      measures: f.counted,
      slot: f.slot,
      structured: { ...pickStructured(f), by: { model: f.model, promptVersion: f.promptVersion } },
      extractedBy: { model: f.model, promptVersion: f.promptVersion },
      verdict: 'unjudged',
      verdictProblem: null,
    })
  }
  return gap
}

const pickStructured = (f: ContextFactData) => ({
  value: f.value,
  valueHigh: f.valueHigh,
  unit: f.unit,
  approx: f.approx,
  provisional: f.provisional,
  counted: f.counted,
  place: f.place,
  asOf: f.asOf,
  credited: f.credited,
  creditedKind: f.creditedKind,
  validity: f.validity,
})

/**
 * The linked earlier stories' facts offered to the gap list and the cards, each once by its key, at
 * most `maxReusedFacts`, under source refs after the pool's. A fact the pool holds already (an earlier
 * pass joined it, or one of the story's pages says it) is the pool's, never offered again: the cards
 * see it under its pool ref as they see the pages' facts, and not at all once the pool demoted it.
 */
function offered(input: PassInput, pool: WorkingPool): ContextFactData[] {
  const linked = new Set(pool.sources.flatMap(s => (s.origin === 'earlier' && s.earlierStoryId ? [s.earlierStoryId] : [])))
  // Numbered after the pool's pages as they stand at each call, so they never take a page's ref
  let next = Number(
    nextSourceRef(
      pool.sources.map(s => s.ref),
      false,
    ).slice(1),
  )
  const ids = new Map<string, string>()
  const count = new Map<string, number>()
  const seen = new Set<string>()
  // The key a cited one joins the pool under (`writeCards`): its page's, as a search source's
  const isNew = ({ fact: f }: OfferedFact) => {
    const key = poolFactKey(f, { url: f.source.url, earlierStoryId: null })
    if (pool.holds(key) || seen.has(key)) return false
    seen.add(key)
    return true
  }
  return input.reusable
    .filter(o => linked.has(o.storyId) && isNew(o))
    .slice(0, config.storyContext.maxReusedFacts)
    .map(({ fact: f }) => {
      if (!ids.has(f.source.url)) ids.set(f.source.url, `S${next++}`)
      const id = ids.get(f.source.url)!
      const n = (count.get(id) ?? 0) + 1
      count.set(id, n)
      const { id: earlierId, ...rest } = f
      return { ...rest, ref: `${id}F${n}`, reusedFromId: f.reusedFromId ?? earlierId, source: { ...f.source, id }, verdict: 'supported', verdictProblem: null }
    })
}

/** The places the cards are written for: the new version's when the pass made one, else the story's as readers see it. */
export function cardsLayout(input: Pick<PassInput, 'story' | 'current'>, version: ArticleVersionData | null): StoryLayout {
  if (!version) return input.current.layout
  return storyLayout({
    url: input.story.original.url,
    summary: version.summary,
    relevanceReasons: version.relevanceReasons,
    antifactors: version.antifactors,
    research: version.research,
  })
}

/**
 * The pass's items checked and failed, for the step's failure share: the cards' tally plus the
 * article's sections, each once however many rounds checked it. Checked: every cited section of the
 * draft research's checks ran on, and every section a later pass's checks ran on; failed: each
 * section the final problems name, which counts as checked too (a section dropped after failing is
 * in no final draft).
 */
export function passItemTally(record: PassRecord): { checked: number; failed: number } {
  const { research, update } = record
  const failed = new Set([...research.problems, ...(update?.problems ?? [])].map(p => p.label))
  const drafted = research.checks.length > 0 && research.draft ? draftItems(research.draft).filter(i => i.cited) : []
  const checked = new Set([...drafted.map(i => i.label), ...(update?.checks ?? []).flatMap(c => c.rechecked ?? []), ...failed])
  return { checked: record.context.tally.checked + checked.size, failed: record.context.tally.failed + failed.size }
}

/** Every call the pass made, research's steps first, each under its pass step's name. */
export function passCalls(record: PassRecord): (Omit<StoryResearch['calls'][number], 'step'> & { step: PassStep })[] {
  return [...record.research.calls, ...(record.update?.calls ?? []), ...record.context.calls.map(c => ({ ...c, step: CARD_STEP_OF[c.step] }))]
}

type CardsResult =
  | { kind: 'written'; boxes: DraftBox[]; facts: Map<string, ContextFactData>; writer: { model: string; promptVersion: string } | null }
  | { kind: 'skipped' }
  | { kind: 'error'; err: unknown }

/** Step 9: the write from the pool's supported, structured facts and the offered ones, on the new version's text (else the story's own); cited offered facts join the pool. */
async function writeCards(
  input: PassInput,
  pool: WorkingPool,
  gap: GapStageResult | null,
  version: ArticleVersionData | null,
  call: ReturnType<typeof stepCaller>,
  context: ContextRunRecord,
): Promise<CardsResult> {
  if (!gap) return { kind: 'skipped' }
  const pages = pool.sources.filter(s => s.origin !== 'earlier')
  const supported = pages.flatMap(s => pool.factsOf(s, f => usable(f) && f.structured !== null).map(f => contextFact(f, s)))
  const reused = offered(input, pool)
  const layout = cardsLayout(input, version)
  const { story } = storyText(version?.title ?? input.current.title, input.storyDay, layout)
  try {
    const written = await writeBoxes(
      {
        story,
        layout,
        storyDay: input.storyDay,
        supported: [...supported, ...reused],
        slots: gap.gap.slots,
        responseInStory: gap.plan.storyReports !== null,
        voices: new Map(pages.map(s => [s.ref, s.voices])),
      },
      call,
      context,
    )
    const all = [...supported, ...reused]
    context.responseNotFound = responseNotFound(gap.plan, all, written.boxes)
    const cited = new Set(written.boxes.flatMap(boxRefs))
    const boxes = written.boxes.map(b => ({ ...b }))
    // An offered fact a kept card cites joins the pool, and the cards cite it by its pool ref
    for (const f of reused.filter(x => cited.has(x.ref))) {
      const source = pool.source({
        origin: 'search',
        earlierStoryId: null,
        url: f.source.url,
        outlet: f.source.outlet,
        title: f.source.title,
        date: f.source.date,
        kind: f.source.kind,
        country: '',
        relation: 'background',
        favicon: null,
        usedRawContent: false,
        voices: [],
        optOutChecked: true,
      })
      const ref = pool.add(source, {
        reusedFromId: f.reusedFromId,
        supportingSentence: f.supportingSentence,
        passage: f.passage,
        supportFound: f.supportFound,
        statement: f.statement,
        measures: f.counted,
        slot: f.slot,
        structured: { ...pickStructured(f), by: { model: f.model, promptVersion: f.promptVersion } },
        extractedBy: { model: f.model, promptVersion: f.promptVersion },
        verdict: 'supported',
        verdictProblem: null,
      })
      for (const b of boxes) renameRef(b, f.ref, ref)
      all.push({ ...f, ref, source: { ...f.source, id: source.ref } })
    }
    return { kind: 'written', boxes, facts: new Map(all.map(f => [f.ref, f])), writer: written.writer }
  } catch (err) {
    return { kind: 'error', err }
  }
}

/** A card's citations of one fact moved to another ref. */
function renameRef(box: DraftBox, from: string, to: string): void {
  if (from === to) return
  const swap = (id: string) => (id === from ? to : id)
  box.sentences = box.sentences.map(s => ({ ...s, factIds: s.factIds.map(swap) }))
  const v = box.visual
  if (!v) return
  box.visual =
    v.kind === 'tiles'
      ? { ...v, tiles: v.tiles.map(t => ({ ...t, factIds: t.factIds.map(swap) })) }
      : {
          ...v,
          points: v.points.map(p => ({ ...p, factId: swap(p.factId) })),
          apart: v.apart ? { ...v.apart, points: v.apart.points.map(p => ({ ...p, factId: swap(p.factId) })) } : v.apart,
        }
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

/**
 * The evidence pool as one research pass works on it (`.context/research-passes.md`, "The pool"): a
 * working copy of the story's pool that takes what the pass finds through its admissions, each source
 * once by its page (or earlier story), each fact once by its key: research's coverage
 * (`admitCoverage`), the gap searches' facts (`admitGapFacts`), and an earlier story's fact a kept card
 * cites (`admitOffered`). The earlier stories' facts are offered under refs the pool reserves for them
 * (`offer`), so a card cites a fact by the ref it keeps once it joins, and no page the pass adds takes
 * a reserved ref. It tracks the stored facts the pass changes. Pure.
 */
import { config } from '../config.js'
import { publishedDay } from './researchChecks.js'
import { nextFactRef, nextSourceRef, poolFactKey, sourceKey, type Pool, type PoolFact, type PoolSource } from './researchPool.js'
import type { StoryResearch } from './researchPipeline.js'
import type { ContextFactData } from './storyContextChecks.js'
import { structured as structuredFields, type ReusableFact } from './storyContextPipeline.js'

/** A linked earlier story's supported, current fact, which the cards may cite (context's step 1). */
export interface OfferedFact {
  storyId: string
  fact: ReusableFact
}

/** Research's extraction prompt is not versioned: its facts carry this, and their model. */
export const RESEARCH_EXTRACT_VERSION = 'research-extract'

type NewSource = Omit<PoolSource, 'id' | 'ref' | 'firstPassId'>
type NewFact = Omit<PoolFact, 'id' | 'ref' | 'sourceRef' | 'firstPassId' | 'checkedBy' | 'status' | 'drop'>

/** An offered or gap fact's page as a search source of the pool. */
const searchPage = (f: Pick<ContextFactData, 'source'>, optOutChecked: boolean): NewSource => ({
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
})

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

/** A context fact as the pool stores it, structured as its extraction gave it. */
const searchFact = (f: ContextFactData, verdict: 'unjudged' | 'supported'): NewFact => ({
  reusedFromId: f.reusedFromId,
  supportingSentence: f.supportingSentence,
  passage: f.passage,
  supportFound: f.supportFound,
  statement: f.statement,
  measures: f.counted,
  slot: f.slot,
  structured: { ...pickStructured(f), by: { model: f.model, promptVersion: f.promptVersion } },
  extractedBy: { model: f.model, promptVersion: f.promptVersion },
  verdict,
  verdictProblem: null,
})

/** A research fact as the pool stores it: unjudged, unstructured. */
const researchFact = (f: { statement: string; supportingSentence: string; measures: string; found: boolean }) => ({
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

/** The pass's working copy of the pool, with the refs it adds and the stored facts it changes. */
export class WorkingPool {
  readonly sources: PoolSource[]
  readonly facts: PoolFact[]
  readonly changed = new Set<string>()
  /** Each fact's key and the ref the pool holds it under. */
  private readonly keys = new Map<string, string>()
  /** Each offered fact by its key, under the refs reserved for it on its first offer. */
  private readonly offers = new Map<string, ContextFactData>()
  /** The source ref reserved for each offered page the pool did not hold when it was first offered, by page key. */
  private readonly offeredPages = new Map<string, string>()

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

  sourceOf(f: Pick<PoolFact, 'sourceRef'>): PoolSource {
    return this.sources.find(s => s.ref === f.sourceRef)!
  }

  /** The pool's pages: every source but our earlier stories. */
  pages(): PoolSource[] {
    return this.sources.filter(s => s.origin !== 'earlier')
  }

  /** A page's or an earlier story's facts, as given. */
  factsOf(s: PoolSource, keep: (f: PoolFact) => boolean = () => true): PoolFact[] {
    return this.facts.filter(f => f.sourceRef === s.ref && keep(f))
  }

  /** The number the next new page takes (`S<n>`), after every page ref held or reserved: where the gap searches number theirs. */
  nextPageNumber(): number {
    return Number(nextSourceRef(this.takenSourceRefs(), false).slice(1))
  }

  update(ref: string, change: Partial<PoolFact>): void {
    const f = this.facts.find(x => x.ref === ref)
    if (!f) return
    Object.assign(f, change)
    if (f.id !== null) this.changed.add(ref)
  }

  /** Research's coverage, its pages and earlier stories under research's ids where they are free; a fact its extraction gave fields is structured already. */
  admitCoverage(r: Pick<StoryResearch, 'sources' | 'earlier' | 'optOutChecked'>, extractModel: string): void {
    const extractedBy = { model: extractModel, promptVersion: RESEARCH_EXTRACT_VERSION }
    for (const s of r.sources) {
      const source = this.source(
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
      // A fact the extraction gave its fields is structured already: no structure call follows for it
      for (const f of s.facts)
        this.add(source, {
          ...researchFact(f),
          ...(f.structured ? { structured: { ...structuredFields(f.structured, s.date), by: extractedBy } } : {}),
          extractedBy,
        })
    }
    for (const e of r.earlier) {
      const source = this.source(
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
      for (const f of e.facts) this.add(source, { ...researchFact(f), extractedBy })
    }
  }

  /** The gap searches' facts, unjudged, each page under the id the gap stage gave it where it is free. */
  admitGapFacts(facts: readonly ContextFactData[], optOutChecked: boolean): void {
    for (const f of facts) this.add(this.source(searchPage(f, optOutChecked), f.source.id), { ...searchFact(f, 'unjudged'), reusedFromId: null })
  }

  /**
   * The linked earlier stories' facts offered to the gap list and the cards, each once by its key, at
   * most `maxReusedFacts`, each under the refs reserved for it: its page's ref when the pool holds the
   * page, else a page ref after every one taken, and a fact ref after its page's. A fact the pool holds
   * already (an earlier pass joined it, or one of the story's pages says it) is the pool's, never
   * offered again: the cards see it under its pool ref as they see the pages' facts, and not at all
   * once the pool demoted it. A fact offered again keeps its refs.
   */
  offer(reusable: readonly OfferedFact[]): ContextFactData[] {
    const linked = new Set(this.sources.flatMap(s => (s.origin === 'earlier' && s.earlierStoryId ? [s.earlierStoryId] : [])))
    const seen = new Set<string>()
    const isNew = ({ fact: f }: OfferedFact) => {
      const key = offeredKey(f)
      if (this.keys.has(key) || seen.has(key)) return false
      seen.add(key)
      return true
    }
    return reusable
      .filter(o => linked.has(o.storyId) && isNew(o))
      .slice(0, config.storyContext.maxReusedFacts)
      .map(({ fact: f }) => this.reserved(f))
  }

  /** An offered fact a kept card cites, joined to the pool under the refs it was offered under, as a supported search fact. */
  admitOffered(f: ContextFactData): void {
    const source = this.source(searchPage(f, true))
    const ref = this.add(source, searchFact(f, 'supported'), f.ref)
    // `offer` leaves out a fact the pool holds, and nothing joins between the offer and the cards
    if (ref !== f.ref) throw new Error(`An offered fact cited as ${f.ref} is held as ${ref}`)
  }

  result(searches: Pool['searches'], dropped: Pool['dropped']): Pool {
    return { sources: this.sources, facts: this.facts, searches: [...this.pool.searches, ...searches], dropped: [...this.pool.dropped, ...dropped] }
  }

  /** The source refs taken: the pool's, and those reserved for offered pages. */
  private takenSourceRefs(): string[] {
    return [...this.sources.map(s => s.ref), ...this.offeredPages.values()]
  }

  /** The fact refs taken: the pool's, and those reserved for offered facts. */
  private takenFactRefs(): string[] {
    return [...this.facts.map(f => f.ref), ...[...this.offers.values()].map(f => f.ref)]
  }

  /** The offered fact under its refs, reserved on its first offer. */
  private reserved(f: ReusableFact): ContextFactData {
    const key = offeredKey(f)
    const held = this.offers.get(key)
    if (held) return held
    const page = sourceKey({ url: f.source.url, earlierStoryId: null })
    let sourceRef = this.sources.find(s => sourceKey(s) === page)?.ref ?? this.offeredPages.get(page)
    if (sourceRef === undefined) {
      sourceRef = nextSourceRef(this.takenSourceRefs(), false)
      this.offeredPages.set(page, sourceRef)
    }
    const { id: earlierId, ...rest } = f
    const offered: ContextFactData = {
      ...rest,
      ref: nextFactRef(sourceRef, this.takenFactRefs()),
      reusedFromId: f.reusedFromId ?? earlierId,
      source: { ...f.source, id: sourceRef },
      verdict: 'supported',
      verdictProblem: null,
    }
    this.offers.set(key, offered)
    return offered
  }

  /** The pool's source for this page or earlier story, added when new: under an offered page's reserved ref, else `ref` when free, else the next free ref. */
  private source(s: NewSource, ref?: string): PoolSource {
    const key = sourceKey(s)
    const known = this.sources.find(x => sourceKey(x) === key)
    if (known) return known
    const taken = this.takenSourceRefs()
    const reserved = s.origin === 'earlier' ? undefined : this.offeredPages.get(key)
    const added: PoolSource = {
      ...s,
      id: null,
      ref: reserved ?? (ref && !taken.includes(ref) ? ref : nextSourceRef(taken, s.origin === 'earlier')),
      firstPassId: this.passId,
    }
    this.sources.push(added)
    return added
  }

  /** A fact of a pool source, added unless the pool holds it already by key, under `ref` or its source's next free one; its ref in the pool either way. */
  private add(source: PoolSource, f: NewFact, ref?: string): string {
    const key = poolFactKey(f, source)
    const known = this.keys.get(key)
    if (known !== undefined) return known
    const added = ref ?? nextFactRef(source.ref, this.takenFactRefs())
    this.keys.set(key, added)
    this.facts.push({ ...f, id: null, ref: added, sourceRef: source.ref, firstPassId: this.passId, checkedBy: null, status: 'unreviewed', drop: null })
    return added
  }
}

/** The key an offered fact joins the pool under (`admitOffered`): its page's, as a search source's. */
const offeredKey = (f: ReusableFact) => poolFactKey(f, { url: f.source.url, earlierStoryId: null })

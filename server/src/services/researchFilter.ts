/**
 * Which candidate sources a researched story keeps: publishers' AI opt-outs (through an injected
 * policy), the deterministic quality rule before extraction (date window, the original's own
 * domain, a blocklist, syndicated copies, one result per domain, the caps and a spread across
 * country domains, raw-content use), and the rule after it (unusable, off-topic, opinion and press
 * releases when a news report exists). No I/O of its own.
 */

/** Sources a story keeps, the original article (S0) included. */
export const MAX_SOURCES = 6
export const MAX_CLUSTER_SOURCES = 2
export const MAX_NEIGHBOUR_SOURCES = 2
/** Below this many characters of content passages, a source's raw content is read instead. */
export const PASSAGE_MIN_CHARS = 800
export const RAW_CONTENT_MAX_CHARS = 4000
/** Every source text the extraction reads is cut to this length. */
export const SOURCE_TEXT_MAX_CHARS = 4000
/** Share of the shorter text's word shingles found in the other: above it, the two are one syndicated text. */
export const SYNDICATION_THRESHOLD = 0.5
const SHINGLE_WORDS = 5
/** Texts with fewer shingles than this are too short to call syndicated. */
const MIN_SHINGLES = 8
export const WINDOW_DAYS_BEFORE = 14
export const WINDOW_DAYS_AFTER = 7
/** An article date further than this before its crawl is taken for a parsing error. */
const PLAUSIBLE_DAYS_BEFORE_CRAWL = 30
const DAY_MS = 24 * 60 * 60 * 1000

/** Press-release mirrors and content farms (design: "press-release mirrors, known content farms"). */
export const BLOCKED_DOMAINS = [
  'prnewswire.com',
  'globenewswire.com',
  'businesswire.com',
  'einpresswire.com',
  'accesswire.com',
  'newswire.com',
  'prweb.com',
  'prlog.org',
  'openpr.com',
  'issuewire.com',
  'newsbreak.com',
  'headtopics.com',
]

/** Second-level labels under a country code that are not a registrable name themselves (`bbc.co.uk`). */
const COUNTRY_SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu', 'or', 'ne', 'go', 'gv', 'nic'])

export type SourceOrigin = 'cluster' | 'neighbour' | 'search'

export interface CandidateSource {
  origin: SourceOrigin
  url: string
  title: string
  outlet: string
  /** `YYYY-MM-DD` or any date `Date.parse` reads; null when unknown. */
  date: string | null
  /** Tavily's content passages, or the stored article text for our own sources. */
  passages: string
  rawContent: string | null
  favicon: string | null
  /** Our story id, for own sources. */
  storyId?: string
}

export interface SelectedSource extends Omit<CandidateSource, 'passages' | 'rawContent'> {
  /** What the extraction reads, cut to `SOURCE_TEXT_MAX_CHARS`. */
  text: string
  usedRawContent: boolean
}

export type DropReason = 'opt-out' | 'date' | 'undated' | 'original' | 'blocklist' | 'syndicated' | 'same-domain' | 'cap'

export interface DroppedSource {
  url: string
  origin: SourceOrigin
  reason: DropReason
}

export interface SearchWindow {
  /** `YYYY-MM-DD`, inclusive. */
  start: string
  end: string
}

export interface FilterInput {
  original: { url: string; text: string }
  /** Cluster members, then confirmed neighbours. */
  own: CandidateSource[]
  /** Search results in Tavily's order. */
  search: CandidateSource[]
  window: SearchWindow
}

export interface FilterResult {
  selected: SelectedSource[]
  dropped: DroppedSource[]
  rawContentUsed: number
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** The date the search window is centred on: the article's own date when plausible, else its crawl date. */
export function anchorDate(published: string | null, crawled: string): string {
  if (published === null) return crawled
  const p = Date.parse(published)
  const c = Date.parse(crawled)
  return p >= c - PLAUSIBLE_DAYS_BEFORE_CRAWL * DAY_MS && p <= c + DAY_MS ? published : crawled
}

/**
 * The search window around the anchor. `latest` (the fixtures' sampling date) caps the end, so a recent
 * story never asks for a future date, and the request stays the same across resumed runs.
 */
export function searchWindow(anchor: string, latest?: string): SearchWindow {
  const at = Date.parse(`${anchor.slice(0, 10)}T00:00:00Z`)
  const end = day(at + WINDOW_DAYS_AFTER * DAY_MS)
  const cap = latest?.slice(0, 10)
  return { start: day(at - WINDOW_DAYS_BEFORE * DAY_MS), end: cap !== undefined && cap < end ? cap : end }
}

/** The registrable domain, roughly: the last two labels, three under a country code's `co.`, `com.` and the like. */
export function domainOf(url: string): string {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
  const labels = host.replace(/^www\./, '').split('.')
  const n = labels.length
  const countryCode = n >= 3 && labels[n - 1]!.length === 2 && COUNTRY_SECOND_LEVEL.has(labels[n - 2]!)
  return labels.slice(countryCode ? -3 : -2).join('.')
}

const tldOf = (domain: string) => domain.split('.').pop() ?? ''

const isBlocked = (domain: string) => BLOCKED_DOMAINS.some(b => domain === b || domain.endsWith(`.${b}`))

function normalizedUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.hostname.toLowerCase().replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`
  } catch {
    return url.trim().toLowerCase()
  }
}

function timeOf(date: string | null): number | null {
  if (date === null) return null
  const t = Date.parse(date)
  return Number.isNaN(t) ? null : t
}

function inWindow(t: number, w: SearchWindow): boolean {
  return t >= Date.parse(`${w.start}T00:00:00Z`) && t < Date.parse(`${w.end}T00:00:00Z`) + DAY_MS
}

function shingles(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
  const out = new Set<string>()
  for (let i = 0; i + SHINGLE_WORDS <= words.length; i++) out.add(words.slice(i, i + SHINGLE_WORDS).join(' '))
  return out
}

/** Share of the smaller set found in the larger one; 0 when either is too short to judge. */
function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size < MIN_SHINGLES || b.size < MIN_SHINGLES) return 0
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  let shared = 0
  for (const s of small) if (large.has(s)) shared++
  return shared / small.size
}

function uniqueByUrl(candidates: CandidateSource[]): CandidateSource[] {
  const seen = new Set<string>()
  return candidates.filter(c => {
    const key = normalizedUrl(c.url)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Indices of candidates that copy an earlier-dated one or the original (which counts as earliest). */
function syndicatedIndices(original: string, candidates: CandidateSource[]): Set<number> {
  const byDate = candidates
    .map((c, i) => ({ i, t: timeOf(c.date) ?? Number.POSITIVE_INFINITY, sh: shingles(c.rawContent || c.passages) }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
  const kept = [shingles(original)]
  const copies = new Set<number>()
  for (const x of byDate) {
    if (kept.some(k => overlap(k, x.sh) >= SYNDICATION_THRESHOLD)) copies.add(x.i)
    else kept.push(x.sh)
  }
  return copies
}

/** Search results for the free slots: first one per country domain not yet covered, then the rest in order. */
function pickSearch(search: CandidateSource[], slots: number, coveredTlds: Set<string>): Set<CandidateSource> {
  const chosen = new Set<CandidateSource>()
  const tlds = new Set(coveredTlds)
  for (const c of search) {
    if (chosen.size >= slots) break
    const tld = tldOf(domainOf(c.url))
    if (!tlds.has(tld)) {
      chosen.add(c)
      tlds.add(tld)
    }
  }
  for (const c of search) {
    if (chosen.size >= slots) break
    chosen.add(c)
  }
  return chosen
}

function selectedText(c: CandidateSource): SelectedSource {
  const { passages, rawContent, ...rest } = c
  const useRaw = c.origin === 'search' && passages.length < PASSAGE_MIN_CHARS && Boolean(rawContent)
  const text = useRaw && rawContent ? rawContent.slice(0, RAW_CONTENT_MAX_CHARS) : passages.slice(0, SOURCE_TEXT_MAX_CHARS)
  return { ...rest, text, usedRawContent: useRaw }
}

/**
 * Publishers' AI opt-outs (design, Risks): whether a page's publisher refuses AI use. The crawler's
 * check plugs in here; until then no run passes one, and its record says the opt-out went unchecked.
 */
export interface SourcePolicy {
  optedOut(url: string): Promise<boolean>
}

/** Drops the own and search candidates the policy reports opted out; without a policy, keeps them all. */
export async function dropOptedOut(
  candidates: { own: CandidateSource[]; search: CandidateSource[] },
  policy: SourcePolicy | undefined,
): Promise<{ own: CandidateSource[]; search: CandidateSource[]; dropped: DroppedSource[] }> {
  if (!policy) return { ...candidates, dropped: [] }
  const dropped: DroppedSource[] = []
  const keep = async (list: CandidateSource[]) => {
    const refused = await Promise.all(list.map(c => policy.optedOut(c.url)))
    for (const [i, c] of list.entries()) if (refused[i]) dropped.push({ url: c.url, origin: c.origin, reason: 'opt-out' })
    return list.filter((_, i) => !refused[i])
  }
  const own = await keep(candidates.own)
  const search = await keep(candidates.search)
  return { own, search, dropped }
}

export function filterCandidates(input: FilterInput): FilterResult {
  const dropped: DroppedSource[] = []
  const drop = (c: CandidateSource, reason: DropReason) => dropped.push({ url: c.url, origin: c.origin, reason })
  const originalDomain = domainOf(input.original.url)

  const aloneReason = (c: CandidateSource): DropReason | null => {
    if (c.origin === 'search') {
      const t = timeOf(c.date)
      if (t === null) return 'undated'
      if (!inWindow(t, input.window)) return 'date'
    }
    const domain = domainOf(c.url)
    if (domain === originalDomain) return 'original'
    if (c.origin === 'search' && isBlocked(domain)) return 'blocklist'
    return null
  }
  const passing = uniqueByUrl([...input.own, ...input.search]).filter(c => {
    const reason = aloneReason(c)
    if (reason) drop(c, reason)
    return reason === null
  })

  const copies = syndicatedIndices(input.original.text, passing)
  const originals = passing.filter((c, i) => {
    if (copies.has(i)) drop(c, 'syndicated')
    return !copies.has(i)
  })

  const domains = new Set<string>()
  const spread = originals.filter(c => {
    const domain = domainOf(c.url)
    const repeat = domains.has(domain)
    if (repeat) drop(c, 'same-domain')
    domains.add(domain)
    return !repeat
  })

  const slots = MAX_SOURCES - 1
  const keptOwn = [
    ...spread.filter(c => c.origin === 'cluster').slice(0, MAX_CLUSTER_SOURCES),
    ...spread.filter(c => c.origin === 'neighbour').slice(0, MAX_NEIGHBOUR_SOURCES),
  ].slice(0, slots)
  const covered = new Set([originalDomain, ...keptOwn.map(c => domainOf(c.url))].map(tldOf))
  const keptSearch = pickSearch(
    spread.filter(c => c.origin === 'search'),
    slots - keptOwn.length,
    covered,
  )
  const kept = spread.filter(c => keptOwn.includes(c) || keptSearch.has(c))
  for (const c of spread) if (!kept.includes(c)) drop(c, 'cap')

  const selected = kept.map(selectedText)
  return { selected, dropped, rawContentUsed: selected.filter(s => s.usedRawContent).length }
}

// ---------------------------------------------------------------------------
// After extraction
// ---------------------------------------------------------------------------

export type ExtractDropReason = 'unusable' | 'off-topic' | 'opinion' | 'press-release'

export interface ExtractionJudgment {
  usable: boolean
  relation: 'same-development' | 'background' | 'off-topic'
  kind: string
}

/**
 * Drops sources the extraction found unusable or off-topic, then opinion pieces and press
 * releases when a news report remains. The original article always stays.
 */
export function keepExtracted<T extends { isOriginal: boolean; extraction: ExtractionJudgment }>(
  sources: T[],
): { kept: T[]; dropped: { source: T; reason: ExtractDropReason }[] } {
  const dropped: { source: T; reason: ExtractDropReason }[] = []
  const usable = sources.filter(s => {
    if (s.isOriginal) return true
    const reason: ExtractDropReason | null = !s.extraction.usable ? 'unusable' : s.extraction.relation === 'off-topic' ? 'off-topic' : null
    if (reason) dropped.push({ source: s, reason })
    return reason === null
  })
  const hasNewsReport = usable.some(s => s.extraction.kind === 'news-report')
  const kept = usable.filter(s => {
    if (s.isOriginal || !hasNewsReport) return true
    const reason: ExtractDropReason | null = s.extraction.kind === 'opinion' ? 'opinion' : s.extraction.kind === 'press-release' ? 'press-release' : null
    if (reason) dropped.push({ source: s, reason })
    return reason === null
  })
  return { kept, dropped }
}

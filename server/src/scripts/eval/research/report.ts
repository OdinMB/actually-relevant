/**
 * The two Markdown files of eval:research. `research-report.md`: cost per step and per story,
 * the fact check's input per call, Tavily credits, the monthly projection beside the design's desk
 * estimate, verdicts, what the own-words checks found (`ownWords.ts`), sources per story, filter
 * drops by reason, raw-content use, fact fidelity and the rating change. `research-drafts.md`: per
 * story, what is published today, then the researched draft with its citations as outlet names
 * and its source list, our earlier stories last. Pure.
 */
import type { Draft } from '../../../schemas/research.js'
import { GATE_KINDS, describeProblem, type GateKind } from '../../../services/researchChecks.js'
import { armKey } from '../models.js'
import { deskEstimateUsd, expectedCredits, MONTHLY_STORIES, projectMonthly, summarizeCosts, type CostLine } from './costs.js'
import type { ResearchFixtures, ResearchStory } from './fixtures.js'
import { ownWords, ownWordsLines } from './ownWords.js'
import { STEP_ARMS, STEP_ESTIMATES, STEPS, type DropKind, type ResearchEarlier, type ResearchSource, type StoryResearch } from './pipeline.js'
import type { SkippedStory } from './storyQueue.js'
import { TAVILY_USD_PER_CREDIT } from './tavily.js'

const OURS = 'Actually Relevant (earlier)'
const DROP_KINDS: DropKind[] = [
  'date',
  'undated',
  'original',
  'blocklist',
  'syndicated',
  'same-domain',
  'cap',
  'extraction-failed',
  'unusable',
  'off-topic',
  'opinion',
  'press-release',
]

const usd = (v: number) => `$${v.toFixed(v < 1 ? 4 : 2)}`
const n = (v: number) => Math.round(v).toLocaleString('en-US')
const pct = (part: number, whole: number) => (whole === 0 ? '—' : `${Math.round((part / whole) * 100)}%`)
const mean = (values: number[]) => (values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length)

export function researchFileNames(limit?: number): { report: string; drafts: string } {
  const tag = limit === undefined ? '' : `-limit-${limit}`
  return { report: `research-report${tag}.md`, drafts: `research-drafts${tag}.md` }
}

/** The outlets whose facts a paragraph or bullet cites, each once, in citation order. */
export function citedOutlets(factIds: string[], r: Pick<StoryResearch, 'sources' | 'earlier'>): string[] {
  const names = factIds.map(id => {
    const sourceId = id.replace(/F\d+$/, '')
    if (r.earlier.some(e => e.id === sourceId)) return OURS
    return r.sources.find(s => s.id === sourceId)?.outlet ?? id
  })
  return [...new Set(names)]
}

export interface RatingChange {
  compared: number
  mean: number
  down: number
  same: number
  up: number
  /** `[research − stored, stories]`, by delta. */
  byDelta: [number, number][]
}

/** Research rating against the stored one, for every story with a draft (informational: the drift check is rollout step 3). */
export function ratingChange(stories: ResearchStory[], results: StoryResearch[]): RatingChange {
  const stored = new Map(stories.map(s => [s.id, s.published.relevance]))
  const deltas = results.flatMap(r => {
    const before = stored.get(r.storyId)
    return r.draft && before !== undefined ? [r.draft.rating - before] : []
  })
  const counts = new Map<number, number>()
  for (const d of deltas) counts.set(d, (counts.get(d) ?? 0) + 1)
  return {
    compared: deltas.length,
    mean: mean(deltas),
    down: deltas.filter(d => d < 0).length,
    same: deltas.filter(d => d === 0).length,
    up: deltas.filter(d => d > 0).length,
    byDelta: [...counts.entries()].sort((a, b) => a[0] - b[0]),
  }
}

export function verdictCounts(results: StoryResearch[]): { kinds: Record<GateKind, number>; fallbackReasons: [string, number][] } {
  const kinds = Object.fromEntries(GATE_KINDS.map(k => [k, 0])) as Record<GateKind, number>
  const reasons = new Map<string, number>()
  for (const r of results) {
    kinds[r.verdict.kind]++
    if (r.verdict.kind === 'fallback') reasons.set(r.verdict.reason, (reasons.get(r.verdict.reason) ?? 0) + 1)
  }
  return { kinds, fallbackReasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]) }
}

export function dropTotals(results: StoryResearch[]): Partial<Record<DropKind, number>> {
  const out: Partial<Record<DropKind, number>> = {}
  for (const r of results) for (const [k, v] of Object.entries(r.drops) as [DropKind, number][]) out[k] = (out[k] ?? 0) + v
  return out
}

// ---------------------------------------------------------------------------
// research-report.md
// ---------------------------------------------------------------------------

export interface ReportInput {
  generatedAt: string
  fixtures: Pick<ResearchFixtures, 'createdAt' | 'anchor' | 'size' | 'dbClass' | 'shortfalls'>
  /** The stories the run covered (after `--limit`). */
  stories: ResearchStory[]
  results: StoryResearch[]
  skipped: SkippedStory[]
  limit?: number
  budgetUsd: number
  /** The folder's spend: model ledger plus Tavily credits. */
  spentUsd: number
  thisRunUsd: number
  creditsRecorded: number
  relevanceMin: number
}

const outcomesOf = (line: CostLine) =>
  Object.entries(line.outcomes)
    .map(([k, v]) => `${k} ${v}`)
    .join(', ') || '—'

function costTable(input: ReportInput): string[] {
  const s = summarizeCosts(input.results)
  const stories = Math.max(1, s.stories)
  const row = (name: string, model: string, line: CostLine, desk: string) =>
    `| ${name} | ${model} | ${line.calls} | ${outcomesOf(line)} | ${n(line.usage.input)} | ${n(line.usage.cached)} | ${n(line.usage.output)} | ${n(line.usage.reasoning)} | ${usd(line.usd)} | ${usd(line.usd / stories)} | ${desk} |`
  return [
    '| Step | Model | Calls | Outcomes | Input | Cached | Output | Reasoning | USD | USD per story | Desk estimate per story |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
    ...STEPS.map(step => {
      const e = STEP_ESTIMATES[step]
      const desk = `${n(e.input)} in / ${n(e.output)} out, ${usd(deskEstimateUsd(step))}${e.inDesign ? '' : ' (not in the design)'}`
      return row(step, armKey(STEP_ARMS[step]), s.perStep[step], desk)
    }),
    row('**Total**', '', s.total, usd(STEPS.filter(st => STEP_ESTIMATES[st].inDesign).reduce((sum, st) => sum + deskEstimateUsd(st), 0)) + ' (design rows)'),
  ]
}

function projectionLines(input: ReportInput): string[] {
  const s = summarizeCosts(input.results)
  const p = projectMonthly(s)
  const designUsd = STEPS.filter(st => STEP_ESTIMATES[st].inDesign).reduce((sum, st) => sum + deskEstimateUsd(st), 0)
  const deskCredits = mean(input.stories.map(st => expectedCredits(st.original.language)))
  const perStory = s.stories === 0 ? 0 : s.total.usd / s.stories
  const creditsPerStory = s.stories === 0 ? 0 : s.credits / s.stories
  return [
    '| Per story | Measured | Desk estimate |',
    '|---|---|---|',
    `| Model calls | ${usd(perStory)} | ${usd(designUsd)} |`,
    `| Tavily credits | ${creditsPerStory.toFixed(2)} | ${deskCredits.toFixed(2)} (one advanced search per query) |`,
    '',
    `**${MONTHLY_STORIES} stories a month:** model calls ${usd(p.modelUsd)}; ${n(p.credits)} credits, ${n(p.freeCredits)} inside the free 1,000 and ${n(p.paidCredits)} above it (${usd(p.tavilyUsd)} at ${usd(TAVILY_USD_PER_CREDIT)} each); **total ${usd(p.totalUsd)}**. The design's desk estimate: about $0.012 per story, ~$3 a month, with Tavily mostly free.`,
  ]
}

function sourceLines(input: ReportInput): string[] {
  const rs = input.results
  const researched = rs.filter(r => r.sources.length > 0)
  const counts = researched.map(r => r.sources.length)
  const byOrigin = (o: ResearchSource['origin']) => mean(researched.map(r => r.sources.filter(s => s.origin === o).length)).toFixed(1)
  const drops = dropTotals(rs)
  const searchKept = rs.reduce((sum, r) => sum + r.sources.filter(s => s.origin === 'search').length, 0)
  const raw = rs.reduce((sum, r) => sum + r.sources.filter(s => s.usedRawContent).length, 0)
  const facts = rs.reduce((sum, r) => sum + r.support.facts, 0)
  const found = rs.reduce((sum, r) => sum + r.support.found, 0)
  return [
    `- **Sources per story** (S0 included, ${researched.length} stories that reached extraction): mean ${mean(counts).toFixed(1)}, min ${counts.length ? Math.min(...counts) : 0}, max ${counts.length ? Math.max(...counts) : 0}; per story on average ${byOrigin('cluster')} cluster members, ${byOrigin('neighbour')} confirmed neighbours, ${byOrigin('search')} search results.`,
    `- **Earlier stories kept** per story: mean ${mean(researched.map(r => r.earlier.length)).toFixed(1)}.`,
    `- **Candidates the filter saw:** ${rs.reduce((sum, r) => sum + r.candidates, 0)}.`,
    '',
    '| Dropped because | Sources |',
    '|---|---|',
    ...DROP_KINDS.map(k => `| ${k} | ${drops[k] ?? 0} |`),
    '',
    `- **Raw content** read instead of the passages for ${raw} of ${searchKept} kept search results (passages under 800 characters).`,
    `- **Fact fidelity:** ${found} of ${facts} supporting sentences (${pct(found, facts)}) occur in their source text (normalized for case, whitespace and quote marks).`,
  ]
}

function ratingLines(input: ReportInput): string[] {
  const c = ratingChange(input.stories, input.results)
  if (c.compared === 0) return ['No draft to compare.']
  return [
    `${c.compared} drafts (passed or failed the check): mean change ${c.mean >= 0 ? '+' : ''}${c.mean.toFixed(2)}; ${c.down} lower, ${c.same} the same, ${c.up} higher than the stored rating. For information only: the drift check is rollout step 3.`,
    '',
    '| Research − stored | Stories |',
    '|---|---|',
    ...c.byDelta.map(([d, k]) => `| ${d > 0 ? '+' : ''}${d} | ${k} |`),
  ]
}

function perStoryTable(input: ReportInput): string[] {
  const s = summarizeCosts(input.results)
  const byId = new Map(input.stories.map(st => [st.id, st]))
  return [
    '| # | Story | Verdict | Sources | Earlier | Calls | USD | Credits | Rating stored → research |',
    '|---|---|---|---|---|---|---|---|---|',
    ...input.results.map((r, i) => {
      const st = byId.get(r.storyId)
      const cost = s.perStory[i]
      const verdict = r.verdict.kind === 'fallback' ? `fallback (${r.verdict.reason})` : r.verdict.kind
      const title = (st?.published.title ?? r.storyId).replace(/\|/g, '/')
      return `| ${i + 1} | ${title} | ${verdict}${r.rewritten ? ', rewritten' : ''} | ${r.sources.length} | ${r.earlier.length} | ${cost?.cost.calls ?? 0} | ${usd(cost?.cost.usd ?? 0)} | ${r.credits} | ${st?.published.relevance ?? '?'} → ${r.draft?.rating ?? '—'} |`
    }),
  ]
}

export function renderResearchReport(input: ReportInput): string {
  const fx = input.fixtures
  const v = verdictCounts(input.results)
  const rewrites = input.results.filter(r => r.rewritten).length
  const drafts = input.results.filter(r => r.draft).length
  const searches = input.results.flatMap(r => r.searches)
  const factCheck = ownWords(input.results).factCheckInput
  return [
    '# Research measurement (eval:research)',
    '',
    `Generated ${input.generatedAt}. Sample: the ${fx.size} newest published stories (newest published ${fx.anchor.slice(0, 10)}), sampled ${fx.createdAt} from the ${fx.dbClass} database copy; researched ${input.results.length}${input.limit !== undefined ? ` (--limit ${input.limit})` : ''}, ${input.skipped.length} skipped for the budget.`,
    '',
    `Spend in this folder: ${usd(input.spentUsd)} of the ${usd(input.budgetUsd)} budget (model ledger plus ${n(input.creditsRecorded)} Tavily credits at ${usd(TAVILY_USD_PER_CREDIT)}, free credits counted as paid); model calls made by this run: ${usd(input.thisRunUsd)}. Cached calls and searches count at what they cost when made, so every number below is what the research of these stories costs.`,
    '',
    '## Cost per step',
    '',
    ...costTable(input),
    '',
    `Fact-check input per call (every item and the outside sources' own words): mean ${n(factCheck.mean)}, max ${n(factCheck.max)} tokens over ${factCheck.calls} calls.`,
    '',
    '## Tavily',
    '',
    `${searches.length} searches (${searches.filter(q => q.cached).length} answered from the cache), ${searches.reduce((sum, q) => sum + q.credits, 0)} credits; ${mean(searches.map(q => q.results)).toFixed(1)} results per search.`,
    '',
    '## Per story and per month',
    '',
    ...projectionLines(input),
    '',
    '## Verdicts',
    '',
    '| Verdict | Stories |',
    '|---|---|',
    ...GATE_KINDS.map(k => `| ${k} | ${v.kinds[k]} |`),
    '',
    `Publish bar for \`research-rating\`: ${input.relevanceMin}. Rewrites: ${rewrites} of ${drafts} drafts.`,
    ...(v.fallbackReasons.length > 0 ? ['', 'Fallback reasons:', ...v.fallbackReasons.map(([reason, k]) => `- ${reason}: ${k}`)] : []),
    '',
    '## Own words',
    '',
    ...ownWordsLines(input.results),
    '',
    '## Sources',
    '',
    ...sourceLines(input),
    '',
    '## Rating change',
    '',
    ...ratingLines(input),
    '',
    '## Per story',
    '',
    ...perStoryTable(input),
    ...(input.skipped.length > 0 ? ['', '## Skipped', '', ...input.skipped.map(s => `- ${s.storyId}: ${s.reason}`)] : []),
    ...(fx.shortfalls.length > 0 ? ['', '## Fixture shortfalls', '', ...fx.shortfalls.map(s => `- ${s}`)] : []),
    '',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// research-drafts.md
// ---------------------------------------------------------------------------

const kindText = (kind: string) => kind.replace(/-/g, ' ')

function cited(text: string, factIds: string[], r: StoryResearch): string {
  const outlets = citedOutlets(factIds, r)
  return outlets.length > 0 ? `${text} [${outlets.join('; ')}]` : text
}

function draftLines(d: Draft, r: StoryResearch, storedRating: number): string[] {
  const quoteSource = r.sources.find(s => s.id === d.quoteSourceId)?.outlet ?? d.quoteSourceId
  return [
    `**${d.titleLabel}: ${d.title}** — rating ${d.rating} (stored ${storedRating})`,
    '',
    ...d.story.flatMap(p => [cited(p.text, p.factIds, r), '']),
    `**Summary:** ${d.summary}`,
    '',
    `> ${d.quote}`,
    `> — ${d.quoteAttribution} (${quoteSource})`,
    '',
    '**Why This Matters**',
    ...d.whyThisMatters.map(b => `- ${cited(b.text, b.factIds, r)}`),
    '',
    '**Caveats**',
    ...d.caveats.map(b => `- ${cited(b.text, b.factIds, r)}`),
    '',
    `**Blurb:** ${d.marketingBlurb}`,
    '',
    '**Relevance calculation**',
    ...d.relevanceCalculation.map(b => (b.startsWith('-') ? b : `- ${b}`)),
    '',
    `**Gate inputs:** old news ${d.oldNews.isOld ? `yes (first happened ${d.oldNews.firstHappened})` : 'no'}; contradicted ${d.contradicted.isContradicted ? `yes (${d.contradicted.factIds.join(', ')})` : 'no'}`,
  ]
}

const factLine = (f: ResearchSource['facts'][number]) =>
  `  - ${f.id}: ${f.statement}${f.measures ? ` (measures: ${f.measures})` : ''} — "${f.supportingSentence}"${f.found ? '' : ' (not found in the source text)'}`

function sourceList(r: StoryResearch, siteUrl: string): string[] {
  const source = (s: ResearchSource) => [
    `- **${s.id}** ${s.outlet} · ${kindText(s.kind)} · ${s.country} · ${s.date?.slice(0, 10) ?? 'undated'} · [${s.title.replace(/[[\]]/g, '')}](${s.url})${s.origin === 'original' ? ' · initially found here' : ` · ${s.origin}`}${s.usedRawContent ? ' · raw content' : ''}`,
    ...s.facts.map(factLine),
  ]
  const ours = (e: ResearchEarlier) => [
    `- **${e.id}** [${e.title.replace(/[[\]]/g, '')}](${siteUrl}/stories/${e.slug ?? ''}) · ${e.date} · ${kindText(e.relation)}`,
    ...e.facts.map(factLine),
  ]
  return [...r.sources.flatMap(source), ...(r.earlier.length > 0 ? ['', '**Earlier on Actually Relevant**', ...r.earlier.flatMap(ours)] : [])]
}

export function renderDrafts(input: { stories: ResearchStory[]; results: StoryResearch[]; siteUrl: string }): string {
  const byId = new Map(input.stories.map(s => [s.id, s]))
  const sections = input.results.map((r, i) => {
    const st = byId.get(r.storyId)
    const p = st?.published
    const verdict = r.verdict.kind === 'fallback' ? `fallback: ${r.verdict.reason}` : r.verdict.kind
    return [
      `## ${i + 1}. ${p?.title ?? r.storyId}`,
      '',
      `${st?.datePublished.slice(0, 10) ?? ''} · [on the site](${input.siteUrl}/stories/${st?.slug ?? ''}) · verdict: **${verdict}**${r.rewritten ? ' (rewritten once)' : ''}`,
      '',
      '### Published today',
      '',
      ...(p
        ? [
            `**${p.titleLabel ?? ''}: ${p.title}** — rating ${p.relevance}`,
            '',
            p.summary,
            '',
            '**Why This Matters**',
            p.whyThisMatters,
            '',
            '**Caveats**',
            p.caveats,
          ]
        : ['(story not in the fixtures)']),
      '',
      '### Researched draft',
      '',
      ...(r.draft ? draftLines(r.draft, r, p?.relevance ?? 0) : [`No draft: research fell back (${verdict}).`]),
      ...(r.problems.length > 0 ? ['', '**Check problems:**', ...r.problems.map(pr => `- ${describeProblem(pr)}`)] : []),
      ...(r.sources.length > 0 ? ['', '### Sources', '', ...sourceList(r, input.siteUrl)] : []),
      '',
    ].join('\n')
  })
  return [
    '# Research drafts (eval:research)',
    '',
    `For a first look at quality: per story, what is published today, then the researched draft. A citation names the outlets whose facts back the paragraph or bullet; our own earlier stories show as "${OURS}". The source texts are untrusted pages from news sites.`,
    '',
    ...sections,
  ].join('\n')
}

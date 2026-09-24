/**
 * Renders the plain-language `results.md`: per-call-site evidence, the
 * monthly cost projection, and the per-tier settings recommended for Phase 2.
 */
import { REASONING_EFFORTS, type ReasoningEffort } from '../../config.js'
import { effortOf } from './decide.js'
import type { Fixtures } from './fixtures.js'
import { MODELS } from './models.js'
import type { DeliverableSummary } from './ratingFiles.js'
import type { ExcludedDraft } from './ratingSets.js'
import type { ArmStats, CallSiteId, CallSiteResult, SuiteName, SuiteResult } from './types.js'

/** Calls per month (inventory of 2026-09-24: estimates from marketing copy and cron config; the app has no usage telemetry). */
export const VOLUMES: Record<CallSiteId, { low: number; high: number }> = {
  preassess: { low: 700, high: 1700 },
  assess: { low: 1200, high: 4500 },
  dedup: { low: 1200, high: 4500 },
  related: { low: 300, high: 3000 },
  'social-pick': { low: 30, high: 30 },
  'social-post': { low: 30, high: 60 },
  selection: { low: 30, high: 90 },
  'newsletter-select': { low: 4, high: 5 },
  'newsletter-intro': { low: 4, high: 5 },
  podcast: { low: 0, high: 4 },
}
const EMBEDDINGS_MONTHLY = { low: 0.01, high: 0.02 }

// ---------------------------------------------------------------------------
// Tier recommendation
// ---------------------------------------------------------------------------

export interface TierRecommendation {
  tier: 'small' | 'medium' | 'large'
  model: string | null
  effort: ReasoningEffort | null
  summary: string
  notes: string[]
}

const LUNA_TIERS: { tier: 'small' | 'medium'; sites: CallSiteId[] }[] = [
  { tier: 'small', sites: ['dedup', 'related', 'preassess'] },
  { tier: 'medium', sites: ['preassess', 'assess', 'social-pick'] },
]
const LARGE_SITES: CallSiteId[] = ['selection', 'newsletter-select', 'newsletter-intro', 'podcast']
const SOL = 'gpt-6-sol@medium'

function lunaTier(tier: 'small' | 'medium', ids: CallSiteId[], byId: Map<CallSiteId, CallSiteResult>): TierRecommendation {
  const missing = ids.filter(id => !byId.has(id))
  if (missing.length > 0) return { tier, model: null, effort: null, summary: `incomplete: ${missing.join(', ')} not run`, notes: [] }
  const sites = ids.map(id => byId.get(id)!)
  const failing = sites.filter(s => s.decision.verdict.kind !== 'winner')
  if (failing.length > 0) {
    return { tier, model: null, effort: null, summary: `no automated recommendation: ${failing.map(s => s.id).join(', ')} have no passing gpt-6-luna arm`, notes: [] }
  }
  // Lowest effort every call site passes at, assuming a site that passes at a
  // lower effort also passes at a higher one (flagged where not tested).
  const winners = sites.map(s => (s.decision.verdict.kind === 'winner' ? s.decision.verdict.arm : ''))
  const effort = winners.map(effortOf).reduce((a, b) => (REASONING_EFFORTS.indexOf(b) > REASONING_EFFORTS.indexOf(a) ? b : a))
  const notes = sites
    .filter(s => !s.decision.passing.includes(`gpt-6-luna@${effort}`))
    .map(s => `${s.id} passed at ${s.decision.verdict.kind === 'winner' ? s.decision.verdict.arm : '?'} and was not tested at ${effort}; this assumes more effort does not hurt it`)
  return { tier, model: 'gpt-6-luna', effort, summary: `gpt-6-luna at ${effort} (passes ${ids.join(', ')})`, notes }
}

export function recommendTierSettings(sites: CallSiteResult[]): TierRecommendation[] {
  const byId = new Map(sites.map(s => [s.id, s]))
  const recs = LUNA_TIERS.map(t => lunaTier(t.tier, t.sites, byId))
  const large = LARGE_SITES.map(id => byId.get(id))
  const failing = LARGE_SITES.filter((_, i) => !large[i]?.decision.passing.includes(SOL))
  recs.push(failing.length === 0
    ? { tier: 'large', model: 'gpt-6-sol', effort: 'medium', summary: 'gpt-6-sol at medium: automated gate passed; switch only after the owner rates the large-tier sets', notes: [] }
    : { tier: 'large', model: 'gpt-5.2', effort: 'medium', summary: `stay on gpt-5.2: Sol did not pass (or did not run) ${failing.join(', ')}`, notes: [] })
  return recs
}

// ---------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------

export function monthlyCost(site: CallSiteResult, arm: string): { low: number; high: number } | null {
  const s = site.stats.find(x => x.arm === arm && x.calls > 0)
  if (!s) return null
  const v = VOLUMES[site.id]
  return { low: s.meanCostUsd * v.low, high: s.meanCostUsd * v.high }
}

/** The arm Phase 2 would run: the automated winner, else the highest-effort candidate tested (flagged). */
function proposedArm(site: CallSiteResult): { arm: string; flagged: boolean } {
  if (site.decision.verdict.kind === 'winner') return { arm: site.decision.verdict.arm, flagged: false }
  return { arm: site.candidates[site.candidates.length - 1] ?? site.baseline, flagged: true }
}

const usd = (v: number) => `$${v < 1 ? v.toFixed(3) : v.toFixed(2)}`
/** Per-call costs are often fractions of a cent. */
const usdPerCall = (v: number) => `$${v < 0.01 ? v.toFixed(5) : v.toFixed(4)}`
const range = (r: { low: number; high: number } | null) => (r ? `${usd(r.low)}–${usd(r.high)}` : 'n/a')

// ---------------------------------------------------------------------------
// "Is gpt-5.2 better in any way?"
// ---------------------------------------------------------------------------

/** Every directional metric, latency percentile and $/call on which arm `a` strictly beats arm `b`. */
function armWins(site: CallSiteResult, a: string, b: string): string[] {
  const model = (arm: string) => arm.split('@')[0]
  const fromMetrics = site.metrics.flatMap(row => {
    const x = row.raw[a]
    const y = row.raw[b]
    if (!row.better || x == null || y == null) return []
    const wins = row.better === 'higher' ? x > y : x < y
    return wins ? [`${site.id}: ${row.name} (${model(a)} ${row.values[a]} vs ${model(b)} ${row.values[b]})`] : []
  })
  const sa = site.stats.find(s => s.arm === a && s.calls > 0)
  const sb = site.stats.find(s => s.arm === b && s.calls > 0)
  const ms = (v: number) => `${v} ms`
  const fromStats = !sa || !sb ? [] : [
    { label: 'median latency', x: sa.latencyP50, y: sb.latencyP50, fmt: ms },
    { label: '95th-percentile latency', x: sa.latencyP95, y: sb.latencyP95, fmt: ms },
    { label: 'cost per call', x: sa.meanCostUsd, y: sb.meanCostUsd, fmt: (v: number) => `$${v.toFixed(4)}` },
  ].flatMap(c => (c.x != null && c.y != null && c.x < c.y ? [`${site.id}: ${c.label} (${model(a)} ${c.fmt(c.x)} vs ${model(b)} ${c.fmt(c.y)})`] : []))
  return [...fromMetrics, ...fromStats]
}

/** Where the baseline rerun strictly beats the (first) candidate. */
export function baselineWins(site: CallSiteResult): string[] {
  const cand = site.candidates[0]
  return cand ? armWins(site, site.baseline, cand) : []
}

/** Where the (first) candidate strictly beats the baseline rerun. */
export function candidateWins(site: CallSiteResult): string[] {
  const cand = site.candidates[0]
  return cand ? armWins(site, cand, site.baseline) : []
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export interface ReportInput {
  generatedAt: string
  fixtures: Pick<Fixtures, 'anchor' | 'floor' | 'dbClass' | 'readOnlyMode' | 'createdAt' | 'shortfalls' | 'adaptations'>
  suites: { name: SuiteName; result: SuiteResult | null; skipped?: string }[]
  limit?: number
  budgetUsd: number
  ledgerUsd: number
  thisRunUsd: number
  rating: DeliverableSummary
}

function exclusionLines(excluded: ExcludedDraft[]): string[] {
  const list = (where: ExcludedDraft['where']) => excluded
    .filter(e => e.where === where)
    .map(e => `${e.set}/${e.key} (${e.terms.join(', ')})`)
    .join('; ')
  const story = excluded.filter(e => e.where === 'context').length
  const option = excluded.filter(e => e.where === 'option').length
  return [
    ...(story > 0 ? ['', `${story} drafted items were left out because the story itself mentions a model name (owner's blinding rule): ${list('context')}.`] : []),
    ...(option > 0 ? ['', `${option} drafted items were left out because a model output named a model: ${list('option')}.`] : []),
  ]
}

function statsTable(stats: ArmStats[], site: CallSiteResult): string[] {
  const head = '| Arm | Calls | ok | parse fail | empty/declined | truncated | error | skipped | p50 ms | p95 ms | in tok | cached | out tok | reasoning | $/call | $/month |'
  const rows = stats.map(s => {
    const o = s.outcomes
    const u = s.meanUsage
    // Judges and other helper arms never run in production, so they get no monthly figure.
    const production = s.arm === site.baseline || site.candidates.includes(s.arm)
    const month = production ? range(monthlyCost(site, s.arm)) : 'n/a (eval only)'
    return `| ${s.arm} | ${s.calls} | ${o.ok} | ${o.parse_failure} | ${o.empty} | ${o.truncated} | ${o.error} | ${o.skipped} | ${s.latencyP50 ?? 'n/a'} | ${s.latencyP95 ?? 'n/a'} | ${Math.round(u.input)} | ${Math.round(u.cached)} | ${Math.round(u.output)} | ${Math.round(u.reasoning)} | ${usdPerCall(s.meanCostUsd)} | ${month} |`
  })
  return [head, `|${'---|'.repeat(16)}`, ...rows]
}

function siteSection(site: CallSiteResult): string[] {
  const arms = [site.baseline, ...site.candidates]
  const verdict = site.decision.verdict
  const verdictLines = verdict.kind === 'winner'
    ? [`**Automated verdict:** ${verdict.arm} passes.`, ...verdict.evidence.map(e => `- ${e}`)]
    : verdict.kind === 'none'
      ? ['**Automated verdict:** no automated winner.', ...verdict.reasons.map(r => `- ${r}`)]
      : [`**Automated verdict:** ${verdict.text}`]
  return [
    `### ${site.title}`,
    '',
    `Arms: ${site.baseline} (today's model, rerun) vs ${site.candidates.join(', ')}.`,
    '',
    ...statsTable(site.stats, site),
    '',
    `| Metric | ${arms.join(' | ')} |`,
    `|${'---|'.repeat(arms.length + 1)}`,
    ...site.metrics.map(m => `| ${m.name} | ${arms.map(a => m.values[a] ?? 'n/a').join(' | ')} |`),
    '',
    ...verdictLines,
    ...(site.ratingSet ? ['', `**Awaits the owner's rating** in set \`actually-relevant-${site.ratingSet}\`.`] : []),
    ...(site.notes.length > 0 ? ['', ...site.notes] : []),
    '',
  ]
}

function costSection(sites: CallSiteResult[]): string[] {
  let cur = { low: EMBEDDINGS_MONTHLY.low, high: EMBEDDINGS_MONTHLY.high }
  let prop = { ...cur }
  const rows = sites.map(site => {
    const current = monthlyCost(site, site.baseline)
    const p = proposedArm(site)
    const proposed = monthlyCost(site, p.arm)
    if (current) cur = { low: cur.low + current.low, high: cur.high + current.high }
    if (proposed) prop = { low: prop.low + proposed.low, high: prop.high + proposed.high }
    return `| ${site.title} | ${VOLUMES[site.id].low}–${VOLUMES[site.id].high} | ${site.baseline} ${range(current)} | ${p.arm}${p.flagged ? ' (no automated winner)' : ''} ${range(proposed)} |`
  })
  return [
    '| Call site | Calls/month | Current | Proposed |',
    '|---|---|---|---|',
    ...rows,
    `| Embeddings (unchanged) | – | ${range(EMBEDDINGS_MONTHLY)} | ${range(EMBEDDINGS_MONTHLY)} |`,
    `| **Total** | | **${range(cur)}** | **${range(prop)}** |`,
    '',
    'Volumes are the inventory estimates (marketing copy and cron config; the app has no usage telemetry). Reclassify, emotion tagging and the backfill scripts have no steady volume and are left out.',
  ]
}

function largeTierSection(sites: CallSiteResult[]): string[] {
  const large = sites.filter(s => LARGE_SITES.includes(s.id))
  if (large.length === 0) return ['The large-tier suite did not run.']
  const wins = large.flatMap(baselineWins)
  const solWins = large.flatMap(candidateWins)
  const cost = (arm: string) => large.reduce((acc, s) => {
    const m = monthlyCost(s, arm)
    return m ? { low: acc.low + m.low, high: acc.high + m.high } : acc
  }, { low: 0, high: 0 })
  return [
    wins.length === 0
      ? '**Not on any automated measure.** On every compliance, failure, rule-violation, latency and cost measure, gpt-6-sol is equal to or better than the gpt-5.2 rerun.'
      : `**Yes, on ${wins.length} automated measure${wins.length === 1 ? '' : 's'}:**`,
    ...wins.map(w => `- ${w}`),
    '',
    'Where gpt-6-sol beats the gpt-5.2 rerun:',
    ...(solWins.length > 0 ? solWins.map(w => `- ${w}`) : ['- none']),
    '',
    'Measures not listed are ties. Cost per call uses the unverified gpt-5.2 price.',
    '',
    `Monthly cost of the four large-tier call sites: gpt-5.2 ${range(cost('gpt-5.2@medium'))} vs gpt-6-sol ${range(cost(SOL))} (gpt-5.2 price unverified).`,
    'Taste is not measured here: the owner rates the selection groups where the two disagree most, the intros and the podcast script.',
  ]
}

export function renderResults(input: ReportInput): string {
  const sites = input.suites.flatMap(s => s.result?.callSites ?? [])
  const recs = recommendTierSettings(sites)
  const awaiting = sites.filter(s => s.ratingSet)
  const prices = Object.entries(MODELS).map(([id, p]) =>
    `| ${id} | ${p.input} | ${p.cached} | ${p.output} | ${p.cacheWrite > 1 ? `${p.cacheWrite}× input` : '–'} | ${p.source}${p.verified ? '' : ' (**unverified**)'} |`)
  return [
    '# GPT-6 model eval: actually-relevant',
    '',
    `Generated ${input.generatedAt}. Database: ${input.fixtures.dbClass}, read-only (${input.fixtures.readOnlyMode} mode). ` +
      `Fixtures sampled ${input.fixtures.createdAt}, anchored on the newest assessed crawl date ${input.fixtures.anchor.slice(0, 10)}, ` +
      `with stored-data samples crawled on or after ${input.fixtures.floor}.`,
    ...(input.limit != null ? ['', `**Partial run:** at most ${input.limit} fixture items per suite (\`--limit\`). Verdicts from a partial run are not evidence.`] : []),
    '',
    '## Recommendation for Phase 2',
    '',
    '| Tier | Setting | Notes |',
    '|---|---|---|',
    ...recs.map(r => `| ${r.tier} | ${r.summary} | ${r.notes.join('; ') || '–'} |`),
    '',
    'Production defaults are unchanged. Phase 2 sets `OPENAI_MODEL_*` / `OPENAI_EFFORT_*` after the owner has rated the taste sets.',
    '',
    '## Is gpt-5.2 better in any way?',
    '',
    ...largeTierSection(sites),
    '',
    '## Monthly cost at inventory volumes',
    '',
    ...costSection(sites),
    '',
    '## Awaiting the owner\'s rating',
    '',
    ...(awaiting.length > 0 ? awaiting.map(s => `- ${s.title}: set \`actually-relevant-${s.ratingSet}\``) : ['- none (the taste suites did not run)']),
    ...input.rating.sets.map(s => `  - \`${s.id}\`: ${s.items} items`),
    ...(input.rating.written ? [] : ['', '`rating-sets.json` already existed in this folder, so this run left it and `rating-key.json` as they were; the sets listed are what it would have written.']),
    ...exclusionLines(input.rating.excluded),
    ...(input.rating.validationErrors.length > 0 ? ['', '**Deliverable validation failed:**', ...input.rating.validationErrors.map(e => `- ${e}`)] : []),
    '',
    'This project has no image call sites, so there is no `images/` folder.',
    '',
    '## Call sites',
    '',
    ...input.suites.filter(s => s.skipped).map(s => `- Suite \`${s.name}\` skipped: ${s.skipped}`),
    '',
    ...sites.flatMap(siteSection),
    '## Fabricated-number spot check',
    '',
    'Pending: read 10 Luna assessments flagged under "Full assessment" against their article text and record the verdicts here.',
    '',
    '## Fixtures',
    '',
    ...(input.fixtures.shortfalls.length > 0 ? ['Shortfalls against the targets (reported, not padded):', ...input.fixtures.shortfalls.map(s => `- ${s}`)] : ['All fixture targets met.']),
    '',
    ...(input.fixtures.adaptations.length > 0
      ? ['Sample adaptations for this database and for blinding:', ...input.fixtures.adaptations.map(s => `- ${s}`), '']
      : []),
    '## Prices (USD per 1M tokens)',
    '',
    '| Model | Input | Cached | Output | Cache write | Source |',
    '|---|---|---|---|---|---|',
    ...prices,
    '',
    'Uncached GPT-6 input is billed at the 1.25× cache-write rate, a conservative upper bound (Chat Completions usage does not report cache writes separately).',
    '',
    '## Spend',
    '',
    `This run: ${usd(input.thisRunUsd)}. Ledger total for this output folder: ${usd(input.ledgerUsd)} of the ${usd(input.budgetUsd)} budget.`,
    '',
    '`n/a` marks a metric with nothing to measure (for example, an arm whose calls all failed). Latencies are wall-clock per call; cached calls reuse the latency recorded when they were made.',
    '',
  ].join('\n')
}

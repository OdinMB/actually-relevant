import type { ReactNode } from 'react'
import type {
  EmotionTag,
  ResearchCitedText,
  ResearchDraft,
  ResearchEarlier,
  ResearchFact,
  ResearchFallbackCategory,
  ResearchProblem,
  ResearchResult,
  ResearchRun,
  ResearchSource,
  ResearchVerdict,
} from '@shared/types'
import { formatDateWithTime } from '../../lib/constants'
import { isHttpsUrl, isHttpUrl } from '../../lib/urls'
import { Badge } from '../ui/Badge'

/**
 * One story research run, read only (`.context/story-research.md`): who started it, its verdict, the
 * draft with citation chips, the sources, the facts and the cost. Every fetched or model-written text renders
 * as React text, never as HTML; a URL becomes a link only when it is http(s), and a favicon loads
 * only from https, without a referrer.
 */

const OUR_OUTLET = 'Actually Relevant'

const usd = (v: number) => `$${v.toFixed(3)}`
const count = (n: number) => n.toLocaleString('en-US')

const VERDICT_NAMES: Record<ResearchVerdict['kind'], string> = {
  keep: 'Keep',
  'research-rating': 'Below the publish bar',
  stale: 'Old news',
  contradicted: 'Contradicted',
  fallback: "Today's format",
}

export function verdictName(kind: ResearchVerdict['kind']): string {
  return VERDICT_NAMES[kind]
}

const FALLBACK_NAMES: Record<ResearchFallbackCategory, string> = {
  no_other_coverage: 'no other coverage',
  not_confirmed: 'not confirmed',
  draft_failed_check: 'draft failed the check',
  technical: 'technical',
}

/** A fallback's category in words (server: `FallbackCategory`, recorded for the owner's count). */
export function fallbackName(category: ResearchFallbackCategory): string {
  return FALLBACK_NAMES[category]
}

/** The verdict's name, with a fallback's category when its run recorded one. */
export function verdictLabel(v: ResearchVerdict): string {
  return v.kind === 'fallback' && v.category ? `${VERDICT_NAMES.fallback} (${fallbackName(v.category)})` : VERDICT_NAMES[v.kind]
}

/** The verdict with its reason or rating, in one sentence. */
export function verdictText(v: ResearchVerdict): string {
  switch (v.kind) {
    case 'keep':
      return 'Keep: the research supports the story at its rating.'
    case 'research-rating':
      return `Below the publish bar: the research rates the story ${v.rating}. Recorded only: the story keeps its own rating and is not rejected.`
    case 'stale':
      return `Old news: the development first happened on ${v.firstHappened}.`
    case 'contradicted':
      return `Contradicted: ${v.factIds.join(', ')} contradict the main claim.`
    case 'fallback':
      return `${verdictLabel(v)}: ${v.reason}.`
  }
}

function SafeLink({ url, children }: { url: string; children?: ReactNode }) {
  if (!isHttpUrl(url)) return <span className="break-all">{children ?? url}</span>
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline break-all">
      {children ?? url}
    </a>
  )
}

function Favicon({ url, outlet }: { url: string | null; outlet: string }) {
  if (url && isHttpsUrl(url)) return <img src={url} alt="" width={14} height={14} referrerPolicy="no-referrer" className="inline-block rounded-sm" />
  return (
    <span aria-hidden="true" className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm bg-neutral-200 text-[0.6rem] font-semibold">
      {outlet.charAt(0).toUpperCase()}
    </span>
  )
}

interface ChipTarget {
  outlet: string
  favicon: string | null
  /** A source's http(s) URL, or our earlier story's page; null when neither is safe to link. */
  href: string | null
}

const CHIP = 'inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 text-xs text-neutral-700 align-middle'

function Chip({ target }: { target: ChipTarget }) {
  const body = (
    <>
      <Favicon url={target.favicon} outlet={target.outlet} />
      <span className="sr-only">Source: </span>
      {target.outlet}
    </>
  )
  if (target.href) {
    return (
      <a href={target.href} target="_blank" rel="noopener noreferrer" className={`${CHIP} hover:border-brand-300`}>
        {body}
      </a>
    )
  }
  return <span className={CHIP}>{body}</span>
}

/** The source (or our own earlier story) each fact id comes from: `S2F3` from S2, `E1F2` from E1. */
function chipTargets(result: ResearchResult): (factId: string) => ChipTarget | undefined {
  const byId = new Map<string, ChipTarget>()
  for (const s of result.sources) byId.set(s.id, { outlet: s.outlet, favicon: s.favicon, href: isHttpUrl(s.url) ? s.url : null })
  for (const e of result.earlier) byId.set(e.id, { outlet: OUR_OUTLET, favicon: null, href: e.slug ? `/stories/${encodeURIComponent(e.slug)}` : null })
  return factId => byId.get(factId.replace(/F\d+$/, ''))
}

function Cited({ item, targetOf }: { item: ResearchCitedText; targetOf: (factId: string) => ChipTarget | undefined }) {
  const seen = new Set<string>()
  const chips = item.factIds.flatMap(id => {
    const target = targetOf(id)
    const key = id.replace(/F\d+$/, '')
    if (!target || seen.has(key)) return []
    seen.add(key)
    return [<Chip key={key} target={target} />]
  })
  return (
    <>
      {item.text}
      {chips.length > 0 && <> {chips}</>}
    </>
  )
}

/** A paragraph's cited texts: the paragraph itself, or the cited sentences of a run stored before 2026-11-13. */
const passagesOf = (p: ResearchDraft['story'][number]): ResearchCitedText[] => ('sentences' in p ? p.sentences : [p])

/** What a problem was and which check found it; nothing for a problem stored before the checks recorded it. */
function causeOf(p: ResearchProblem): string {
  if (!p.kind || !p.by) return ''
  return ` (${p.kind}, ${p.by === 'judge' ? 'AI check' : 'code check'})`
}

/** A rating-calculation line without its Markdown bullet and bold markers. */
const plainLine = (line: string) => line.replace(/^\s*-\s*/, '').replace(/\*\*/g, '')

const H = 'text-xs font-semibold text-neutral-500 uppercase tracking-wide'
const SUMMARY = 'cursor-pointer text-sm font-medium text-neutral-800 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500'

/** The story's single-source tag beside the research's, when the view is given it. */
const besideSingleSource = (tag: EmotionTag | null | undefined) => (tag === undefined ? '' : ` (single-source: ${tag ?? 'none'})`)

function Draft({ result, singleSourceEmotion }: { result: ResearchResult; singleSourceEmotion?: EmotionTag | null }) {
  const draft = result.draft
  if (!draft) return <p className="text-sm text-neutral-600">No draft was written.</p>
  const targetOf = chipTargets(result)
  const quoteSource = result.sources.find(s => s.id === draft.quoteSourceId)
  return (
    <div className="space-y-3 text-sm text-neutral-800">
      <div>
        <p className="text-xs font-medium text-brand-700">{draft.titleLabel}</p>
        <h4 className="text-base font-semibold text-neutral-900">{draft.title}</h4>
      </div>
      {draft.story.map((p, i) => (
        <p key={i}>
          {passagesOf(p).map((s, j) => (
            <span key={j}>
              {j > 0 && ' '}
              <Cited item={s} targetOf={targetOf} />
            </span>
          ))}
        </p>
      ))}
      <div>
        <h5 className={H}>Summary</h5>
        <p>{draft.summary}</p>
      </div>
      <div>
        <h5 className={H}>Why This Matters</h5>
        <ul className="list-disc pl-5 space-y-1">
          {draft.whyThisMatters.map((b, i) => (
            <li key={i}>
              <Cited item={b} targetOf={targetOf} />
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h5 className={H}>Caveats</h5>
        <ul className="list-disc pl-5 space-y-1">
          {draft.caveats.map((b, i) => (
            <li key={i}>
              <Cited item={b} targetOf={targetOf} />
            </li>
          ))}
        </ul>
      </div>
      {draft.quote && (
        <figure>
          <h5 className={H}>Quote</h5>
          <blockquote className="border-l-2 border-neutral-300 pl-3 italic">{draft.quote}</blockquote>
          <figcaption className="text-xs text-neutral-600">
            {draft.quoteAttribution}
            {quoteSource ? `, in ${quoteSource.outlet}` : ` (source ${draft.quoteSourceId} not found)`}
          </figcaption>
        </figure>
      )}
      <div>
        <h5 className={H}>Blurb</h5>
        <p>{draft.marketingBlurb}</p>
      </div>
      {draft.emotionTag && (
        <h5 className={H}>
          Research&apos;s emotion: {draft.emotionTag}
          {besideSingleSource(singleSourceEmotion)}
        </h5>
      )}
      <div>
        <h5 className={H}>Research&apos;s rating: {draft.rating} (recorded; the story keeps its own)</h5>
        <ul className="list-disc pl-5">
          {draft.relevanceCalculation.map((line, i) => (
            <li key={i}>{plainLine(line)}</li>
          ))}
        </ul>
      </div>
      {result.problems.length > 0 && (
        <div>
          <h5 className={H}>
            {result.verdict.kind === 'fallback'
              ? `What the checks found${result.rewritten ? ' after repair' : ''}`
              : 'Left out of the draft above: still failing the checks after repair'}
          </h5>
          <ul className="list-disc pl-5">
            {result.problems.map((p, i) => (
              <li key={i}>
                {p.label}: {p.problem}
                {causeOf(p)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function SourceRow({ source }: { source: ResearchSource }) {
  return (
    <li className="space-y-0.5">
      <p className="font-medium text-neutral-900">
        {source.id} · {source.outlet}
      </p>
      <p>
        <SafeLink url={source.url} />
      </p>
      <p className="text-neutral-600">
        {[source.date ?? 'undated', source.kind, source.country, source.origin, source.relation].join(' · ')}
        {source.usedRawContent ? ' · full text' : ''}
      </p>
      <p className="text-neutral-500 break-all">Favicon: {source.favicon ?? 'none'}</p>
    </li>
  )
}

function FactList({ facts }: { facts: ResearchFact[] }) {
  if (facts.length === 0) return <p className="text-neutral-500">No facts.</p>
  return (
    <ul className="space-y-2">
      {facts.map(f => (
        <li key={f.id}>
          <p>
            <span className="font-mono text-xs text-neutral-500">{f.id}</span> {f.statement}
          </p>
          <p className="text-neutral-600">“{f.supportingSentence}”</p>
          <p className={f.found ? 'text-green-700' : 'text-amber-700'}>{f.found ? 'Found in the source text' : 'Not found in the source text'}</p>
        </li>
      ))}
    </ul>
  )
}

function EarlierFacts({ story }: { story: ResearchEarlier }) {
  return (
    <div>
      <p className="font-medium text-neutral-900">
        {story.id} · {OUR_OUTLET}: {story.title}
      </p>
      <p className="text-neutral-600">
        {story.date} · {story.relation}
      </p>
      <FactList facts={story.facts} />
    </div>
  )
}

function CostTable({ run }: { run: ResearchRun }) {
  const cost = run.cost
  const result = run.result
  if (!cost || !result) return <p className="text-neutral-500">No cost recorded.</p>
  const drops = Object.entries(result.drops).filter((e): e is [string, number] => (e[1] ?? 0) > 0)
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <caption className="sr-only">Cost per step</caption>
          <thead>
            <tr className="text-left text-neutral-500">
              <th scope="col" className="pr-3">
                Step
              </th>
              <th scope="col" className="pr-3 text-right">
                Calls
              </th>
              <th scope="col" className="pr-3 text-right">
                Input
              </th>
              <th scope="col" className="pr-3 text-right">
                Cached
              </th>
              <th scope="col" className="pr-3 text-right">
                Output
              </th>
              <th scope="col" className="pr-3 text-right">
                Reasoning
              </th>
              <th scope="col" className="pr-3">
                Model
              </th>
              <th scope="col" className="text-right">
                USD
              </th>
            </tr>
          </thead>
          <tbody>
            {cost.steps.map(s => (
              <tr key={s.step}>
                <th scope="row" className="pr-3 text-left font-normal">
                  {s.step}
                </th>
                <td className="pr-3 text-right">{s.calls}</td>
                <td className="pr-3 text-right">{count(s.usage.input)}</td>
                <td className="pr-3 text-right">{count(s.usage.cached)}</td>
                <td className="pr-3 text-right">{count(s.usage.output)}</td>
                <td className="pr-3 text-right">{count(s.usage.reasoning)}</td>
                <td className="pr-3">{s.models.join(', ')}</td>
                <td className="text-right">{usd(s.usd)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="font-medium">
            <tr>
              <th scope="row" className="pr-3 text-left">
                Models
              </th>
              <td className="pr-3 text-right">{cost.model.calls}</td>
              <td className="pr-3 text-right">{count(cost.model.usage.input)}</td>
              <td className="pr-3 text-right">{count(cost.model.usage.cached)}</td>
              <td className="pr-3 text-right">{count(cost.model.usage.output)}</td>
              <td className="pr-3 text-right">{count(cost.model.usage.reasoning)}</td>
              <td className="pr-3">{cost.model.models.join(', ')}</td>
              <td className="text-right">{usd(cost.model.usd)}</td>
            </tr>
            <tr>
              <th scope="row" className="pr-3 text-left">
                Tavily
              </th>
              <td colSpan={6} className="pr-3">
                {count(cost.tavily.credits)} credits
              </td>
              <td className="text-right">{usd(cost.tavily.usd)}</td>
            </tr>
            <tr>
              <th scope="row" className="pr-3 text-left">
                Total
              </th>
              <td colSpan={6} />
              <td className="text-right">{usd(cost.totalUsd)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-neutral-500">
        Uncached input is counted at {result.prices.cacheWriteFactor} times the input price, an upper bound: the API reports no cache writes.
      </p>
      <div>
        <h5 className={H}>Searches</h5>
        {result.searches.length === 0 ? (
          <p className="text-neutral-500">None.</p>
        ) : (
          <ul className="list-disc pl-5">
            {result.searches.map((s, i) => (
              <li key={i}>
                {s.query} ({s.language}): {s.results} results, {s.credits} credits{s.cached ? ', cached' : ''}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h5 className={H}>Filter</h5>
        <p>
          {result.candidates} candidates
          {drops.length > 0 ? `; dropped: ${drops.map(([reason, n]) => `${reason} ${n}`).join(', ')}` : '; none dropped'}
        </p>
      </div>
    </div>
  )
}

/** The prefix of the error the research step records on a run it skipped without researching (server: `recordSkippedRun`). */
const SKIPPED = 'skipped: '

/** Who started the run: an editor's Research button, or the research step (`research_stories`). */
function RunTrigger({ run }: { run: Pick<ResearchRun, 'trigger'> }) {
  const pipeline = run.trigger === 'pipeline'
  return (
    <Badge variant={pipeline ? 'purple' : 'gray'}>
      <span className="sr-only">Started by: </span>
      {pipeline ? 'Pipeline' : 'Editor'}
    </Badge>
  )
}

/**
 * A run's cost as counted against the cap: the reservation until its result is stored, then the
 * measured cost (also when it failed after that, e.g. in the research step's apply).
 */
const countedCost = (run: ResearchRun) => `${run.result ? 'Its measured cost of' : 'Its reservation of'} ${usd(run.costUsd)}`

function RunStatus({ run }: { run: ResearchRun }) {
  if (run.status === 'running') {
    return (
      <p className="text-sm text-neutral-700">
        Running since {formatDateWithTime(run.startedAt)}. {countedCost(run)} counts against the cap until it ends.
      </p>
    )
  }
  if (run.status === 'failed' && run.error?.startsWith(SKIPPED)) {
    return (
      <p className="text-sm text-neutral-700">
        Skipped by the research step: {run.error.slice(SKIPPED.length)}. Nothing was researched or counted against the cap, and the story was not held back from
        publishing.
      </p>
    )
  }
  if (run.status === 'failed') {
    return (
      <p className="text-sm text-red-700">
        {run.result ? 'Failed after its research' : 'Failed'}: {run.error ?? 'no reason recorded'}. {countedCost(run)} stays counted against the cap.
      </p>
    )
  }
  return null
}

/** `singleSourceEmotion`: the story's single-source emotion tag, shown beside the one research gave its text. */
export function ResearchRunView({ run, singleSourceEmotion }: { run: ResearchRun; singleSourceEmotion?: EmotionTag | null }) {
  const result = run.result
  return (
    <div className="space-y-3">
      <RunTrigger run={run} />
      <RunStatus run={run} />
      {result && (
        <>
          <p className="text-sm font-medium text-neutral-900">{verdictText(result.verdict)}</p>
          {!result.optOutChecked && (
            <p className="text-xs text-amber-700">AI opt-out not checked: publishers' AI opt-outs were not applied to these sources.</p>
          )}
          <Draft result={result} singleSourceEmotion={singleSourceEmotion} />
          <details>
            <summary className={SUMMARY}>Sources ({result.sources.length})</summary>
            <ul className="mt-2 space-y-3 text-xs text-neutral-700">
              {result.sources.map(s => (
                <SourceRow key={s.id} source={s} />
              ))}
            </ul>
          </details>
          <details>
            <summary className={SUMMARY}>Facts</summary>
            <div className="mt-2 space-y-4 text-xs text-neutral-700">
              {result.sources.map(s => (
                <div key={s.id}>
                  <p className="font-medium text-neutral-900">
                    {s.id} · {s.outlet}
                  </p>
                  <FactList facts={s.facts} />
                </div>
              ))}
              {result.earlier.map(e => (
                <EarlierFacts key={e.id} story={e} />
              ))}
              <p className="text-neutral-500">
                Supporting sentences found in their source text: {result.support.found} of {result.support.facts}.
              </p>
            </div>
          </details>
          <details>
            <summary className={SUMMARY}>Cost ({usd(run.costUsd)})</summary>
            <div className="mt-2 text-xs text-neutral-700">
              <CostTable run={run} />
            </div>
          </details>
        </>
      )}
      {!result && run.status === 'completed' && <p className="text-sm text-neutral-600">No result stored.</p>}
    </div>
  )
}

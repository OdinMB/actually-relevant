import type { ContextAdminBox, ContextAdminRun, ContextRunRecord } from '@shared/types'
import { slotKicker } from '../context/contextText'

/**
 * "What the run did" under a story's Context section (`.context/story-context.md`, "Records"): what
 * the context run looked for and how each slot came out, its web searches, what the checks dropped and
 * why, and its cost. Read only; every recorded text renders as React text.
 */

const usd = (v: number) => `$${v.toFixed(3)}`
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

const SUMMARY = 'cursor-pointer text-sm font-medium text-neutral-800 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500'
const H = 'mb-1 mt-3 text-xs font-semibold text-neutral-600'
const ROW = 'flex items-start justify-between gap-4 border-b border-neutral-100 py-1.5 last:border-b-0'
const NOTE = 'shrink-0 text-right text-neutral-500'

/** As stored: a run that ended early lacks parts. */
type RunRecord = Partial<ContextRunRecord>

/** The outcomes in the order the rows show them: what the run found first, what it did not need last. */
const OUTCOMES = [
  'found',
  'found with a search of its own',
  'the story itself reports it',
  'searched, nothing found: the page says so',
  'searched, nothing the sources support',
  'nothing the sources support, so no card',
  'not needed',
] as const
type Outcome = (typeof OUTCOMES)[number]

/**
 * How each slot came out, grouped as the run left it: found (with or without a search of its own), the
 * honest gap, reported by the story itself, not needed, or needed with nothing kept. In numbers counts
 * as found when the run kept it; hidden cards count too, since the run found them.
 */
export function slotOutcomes(record: RunRecord, boxes: ContextAdminBox[]): { outcome: string; slots: string[] }[] {
  const kept = new Set(boxes.filter(b => !b.gap).map(b => b.type))
  const gap = boxes.some(b => b.gap)
  const searched = new Set((record.searches ?? []).map(s => s.slot))
  const groups = new Map<string, string[]>(OUTCOMES.map(outcome => [outcome, []]))
  const add = (outcome: Outcome, slot: string) => groups.get(outcome)!.push(slot)

  if (kept.has('figures')) add('found', slotKicker('figures'))
  for (const { slot, needed } of record.slots ?? []) {
    const name = slotKicker(slot)
    if (kept.has(slot)) add(searched.has(slot) ? 'found with a search of its own' : 'found', name)
    else if (slot === 'response' && gap) add('searched, nothing found: the page says so', name)
    else if (slot === 'response' && record.responseInStory) add('the story itself reports it', name)
    else if (!needed) add('not needed', name)
    else if (searched.has(slot)) add('searched, nothing the sources support', name)
    else add('nothing the sources support, so no card', name)
  }
  return [...groups].filter(([, slots]) => slots.length > 0).map(([outcome, slots]) => ({ outcome, slots }))
}

const SOURCE_DROPS: { [K in ContextRunRecord['sourceDrops'][number]['reason']]: string } = {
  'opt-out': 'publisher opted out of AI use',
  blocklist: 'on the blocklist',
  known: 'already a source',
  empty: 'no text',
  'per-query': 'over 2 from one search',
  cap: 'over the 5 new sources',
}

const BOX_DROPS: { [K in ContextRunRecord['boxDrops'][number]['cause']]: string } = {
  structure: 'cited a fact that is not shown',
  expired: 'its facts were out of date',
  undrawn: 'chart not drawn: it breaks the chart rules',
  check: 'failed the check',
  unjudged: 'the check gave no verdict',
  copying: 'too close to its source’s wording',
  empty: 'nothing left in it',
}

function Searches({ record }: { record: RunRecord }) {
  const searches = record.searches ?? []
  const cached = searches.filter(s => s.cached).length
  const drops = new Map<string, number>()
  for (const d of record.sourceDrops ?? []) drops.set(SOURCE_DROPS[d.reason], (drops.get(SOURCE_DROPS[d.reason]) ?? 0) + 1)
  const unusable = record.extractionDrops?.length ?? 0
  return (
    <>
      <h4 className={H}>
        Searches: {searches.length === 0 ? 'none' : plural(searches.length, 'web search', 'web searches')}
        {cached > 0 && `, ${cached} of them answered from the cache`}
      </h4>
      {searches.length > 0 && (
        <ul>
          {searches.map((s, i) => (
            <li key={i} className={ROW}>
              <span className="text-neutral-900">“{s.query}”</span>
              <span className={NOTE}>
                {slotKicker(s.slot)} · {plural(s.results, 'result')}, {s.kept.length} kept{s.cached ? ' · from the cache' : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      {record.responseFallback && (
        <p className="text-neutral-500">The {slotKicker('response')} search was added from the headline: the gap list asked for none.</p>
      )}
      {drops.size > 0 && <p className="text-neutral-500">Results left out: {[...drops].map(([reason, n]) => `${n} ${reason}`).join(', ')}.</p>}
      {unusable > 0 && <p className="text-neutral-500">{plural(unusable, 'source')} gave no usable facts.</p>}
    </>
  )
}

function Checks({ record }: { record: RunRecord }) {
  const tally = record.tally ?? { checked: 0, failed: 0 }
  const facts = record.droppedFacts ?? []
  const cards = record.boxDrops ?? []
  return (
    <>
      <h4 className={H}>
        Checks: {plural(tally.checked, 'fact and card line', 'facts and card lines')} checked, {tally.checked - tally.failed} kept, {tally.failed} dropped
      </h4>
      {(facts.length > 0 || cards.length > 0) && (
        <ul>
          {facts.map(f => (
            <li key={f.ref} className="border-b border-neutral-100 py-1.5 last:border-b-0">
              <div className="flex items-start justify-between gap-4">
                <span className="text-neutral-900">“{f.text}”</span>
                <span className="shrink-0 font-semibold text-red-700">{f.verdict === 'rejected' ? 'dropped' : 'not judged'}</span>
              </div>
              {f.problem && <p className="text-neutral-500">{f.problem}</p>}
            </li>
          ))}
          {cards.map((d, i) => (
            <li key={i} className="border-b border-neutral-100 py-1.5 last:border-b-0">
              <div className="flex items-start justify-between gap-4">
                <span className="text-neutral-900">{d.label}</span>
                <span className="shrink-0 text-right text-neutral-500">{BOX_DROPS[d.cause]}</span>
              </div>
              {d.problem && <p className="text-neutral-500">{d.problem}</p>}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function Cost({ run }: { run: ContextAdminRun }) {
  const calls = run.result?.calls?.length ?? 0
  return (
    <>
      <h4 className={H}>Cost</h4>
      <ul>
        <li className={ROW}>
          {/* A record without its calls (one written by hand) gives no count rather than "0 calls" */}
          <span>{calls > 0 ? `AI, ${plural(calls, 'call')}` : 'AI'}</span>
          <span className={NOTE}>{usd(run.modelUsd)}</span>
        </li>
        <li className={ROW}>
          <span>Web search, {plural(run.tavilyCredits, 'credit')}</span>
          <span className={NOTE}>{usd(run.searchUsd)}</span>
        </li>
        <li className={`${ROW} font-semibold text-neutral-900`}>
          <span>This story</span>
          <span className="shrink-0 text-right">{usd(run.costUsd)}</span>
        </li>
      </ul>
    </>
  )
}

export function ContextRunView({ run, boxes }: { run: ContextAdminRun; boxes: ContextAdminBox[] }) {
  const record = run.result
  return (
    <details className="rounded-md border border-neutral-200 bg-white px-3.5 py-2.5">
      <summary className={SUMMARY}>What the run did</summary>
      <div className="mt-1 text-xs text-neutral-700">
        {record ? (
          <>
            <h4 className={H}>What it looked for</h4>
            <ul>
              {slotOutcomes(record, boxes).map(({ outcome, slots }) => (
                <li key={outcome} className={ROW}>
                  <span className="text-neutral-900">{slots.join(', ')}</span>
                  <span className={NOTE}>{outcome}</span>
                </li>
              ))}
            </ul>
            {record.responseInStory && <p className="text-neutral-500">The story reports what is being done: “{record.responseInStory}”</p>}
            <Searches record={record} />
            <Checks record={record} />
            {record.optOutChecked === false && (
              <p className="mt-2 text-amber-700">AI opt-out not checked: publishers&apos; AI opt-outs were not applied to the searched sources.</p>
            )}
          </>
        ) : (
          <p className="mt-2 text-neutral-500">The run recorded no details.</p>
        )}
        <Cost run={run} />
      </div>
    </details>
  )
}

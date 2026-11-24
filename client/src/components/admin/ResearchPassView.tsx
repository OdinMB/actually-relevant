import type { ReactNode } from 'react'
import type {
  ArticleVersionView,
  EmotionTag,
  PassRecord,
  PassSectionJudgment,
  PoolFactView,
  ResearchedCitedText,
  ResearchPass,
  ResearchProblem,
  StoryPasses,
} from '@shared/types'
import { formatDateWithTime } from '../../lib/constants'
import { Badge } from '../ui/Badge'
import { ResearchDraftView, RunTrigger, SafeLink, verdictText } from './ResearchRunView'
import { REMOVED_FIGURE_REASONS, RemovedFigureText, type RemovedFigure } from './removedFigures'

/**
 * One research pass, read only (`.context/research-passes.md`): who started it and what became of
 * it; what changed (a first pass's article, or a later pass's judgment of each section with its
 * before and after and the Update note); the searches it made and skipped; the sources it added; the
 * facts it found, checked, rejected and demoted, and the figures it removed from them; its cards; the
 * checks; and its cost. Beside it, the story's versions and its whole evidence pool. Every fetched or
 * model-written text renders as React text, never as HTML.
 */

const H = 'text-xs font-semibold text-neutral-500 uppercase tracking-wide'
const SUMMARY = 'cursor-pointer text-sm font-medium text-neutral-800 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500'

const usd = (v: number) => `$${v.toFixed(3)}`

/** A pass in the picker: its number, when, who, what came of it and its cost. */
export function passLabel(pass: ResearchPass): string {
  const by = pass.trigger === 'pipeline' ? 'pipeline' : 'editor'
  return `Pass ${pass.number} · ${formatDateWithTime(pass.startedAt)} · ${by} · ${pass.outcome ? OUTCOME_NAMES[pass.outcome] : pass.status} · ${usd(pass.costUsd)}`
}

const OUTCOME_NAMES: Record<NonNullable<ResearchPass['outcome']>, string> = {
  written: 'written',
  stale: 'old news',
  contradicted: 'contradicted',
  'research-rating': 'below the publish bar',
  fallback: "today's format",
  budget: 'budget',
  technical: 'technical failure',
  updated: 'updated',
  unchanged: 'unchanged',
  update_failed: 'update failed',
}

/** What became of the pass, in one sentence. */
function outcomeText(pass: ResearchPass): string | null {
  const verdict = pass.record?.research?.verdict
  switch (pass.outcome) {
    case null:
      return null
    case 'written':
      return 'Written: the story took the researched version this pass wrote.'
    case 'stale':
    case 'contradicted': {
      const text = verdict ? verdictText(verdict) : `${OUTCOME_NAMES[pass.outcome]}.`
      // The step's pass rejects the story on this verdict; an editor's leaves it to the editor
      return pass.trigger === 'editor' ? `${text} Recorded only: a pass an editor starts never rejects the story.` : text
    }
    case 'research-rating':
    case 'fallback':
      return verdict ? verdictText(verdict) : `${OUTCOME_NAMES[pass.outcome]}.`
    case 'budget':
      return 'Stopped by the budget: the article was left as it was.'
    case 'technical':
      return 'Failed on a technical error: the article was left as it was.'
    case 'updated':
      return 'Updated: the sections below were rewritten, with an Update readers see.'
    case 'unchanged':
      return 'Article unchanged: nothing new makes it wrong or substantially different.'
    case 'update_failed':
      return `Research found the story out of date and could not fix it${pass.record?.update?.failedOn ? ` (${pass.record.update.failedOn})` : ''}: the article stays as it was.`
  }
}

function PassStatus({ pass }: { pass: ResearchPass }) {
  if (pass.status === 'running')
    return (
      <p className="text-sm text-neutral-700">
        Running since {formatDateWithTime(pass.startedAt)}. Its reservation of {usd(pass.costUsd)} counts against the cap until it ends.
      </p>
    )
  if (pass.status === 'skipped') return <p className="text-sm text-neutral-700">Skipped: {pass.error ?? 'no reason recorded'}.</p>
  if (pass.status === 'failed')
    return (
      <p className="text-sm text-red-700">
        Failed: {pass.error ?? 'no reason recorded'}. Its {usd(pass.costUsd)} stays counted against the cap.
      </p>
    )
  return null
}

const VERDICT_WORDS: Record<NonNullable<PassSectionJudgment['verdict']>, string> = {
  unchanged: 'unchanged',
  wrong: 'wrong now',
  substantially_different: 'substantially different now',
}

const SECTION_OUTCOMES: Record<PassSectionJudgment['outcome'], string> = {
  unchanged: 'kept',
  rewrite: 'rewritten',
  'demoted-fact': 'rewritten: it cited a demoted fact',
  unfounded: 'kept: flagged without a fact found since',
  'follows-opening': 'checked with the rewritten opening',
}

const cited = (t: ResearchedCitedText | null) => (t ? t.text : '')

function Judgments({ judgments }: { judgments: PassSectionJudgment[] }) {
  if (judgments.length === 0) return null
  return (
    <div>
      <h4 className={H}>How each section was judged</h4>
      <ul className="mt-1 space-y-1 text-sm text-neutral-800">
        {judgments.map(j => (
          <li key={j.label}>
            <span className="font-medium">{j.label}</span>: {j.verdict ? VERDICT_WORDS[j.verdict] : 'not judged'}, {SECTION_OUTCOMES[j.outcome]}
            {j.reason && <span className="text-neutral-600"> · {j.reason}</span>}
            {j.factIds.length > 0 && <span className="font-mono text-xs text-neutral-500"> {j.factIds.join(', ')}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Each section the version changed, before and after. */
function VersionChanges({ version }: { version: ArticleVersionView }) {
  return (
    <div className="space-y-3">
      <ul className="space-y-3 text-sm">
        {version.changes.map(c => (
          <li key={`${c.from}-${c.section}`} className="rounded-md border border-neutral-200 p-3">
            <p className="font-medium text-neutral-900">{c.from === c.section ? c.section : `${c.from}, now ${c.section}`}</p>
            <p className="mt-1 text-neutral-600">
              <span className={H}>Before</span> {c.before ? cited(c.before) : 'none (added)'}
            </p>
            <p className="mt-1 text-neutral-900">
              <span className={H}>After</span> {c.after ? cited(c.after) : 'removed'}
            </p>
          </li>
        ))}
      </ul>
      {version.note && (
        <div>
          <h4 className={H}>The Update note readers see</h4>
          <p className="text-sm text-neutral-800">{version.note.text}</p>
        </div>
      )}
    </div>
  )
}

function WhatChanged({
  pass,
  version,
  singleSourceEmotion,
}: {
  pass: ResearchPass
  version: ArticleVersionView | null
  singleSourceEmotion?: EmotionTag | null
}) {
  const record = pass.record
  if (pass.kind === 'first') {
    if (!record?.research) return null
    return <ResearchDraftView result={record.research} singleSourceEmotion={singleSourceEmotion} />
  }
  const update = record?.update
  return (
    <div className="space-y-3">
      {update && <Judgments judgments={update.judgments} />}
      {version && <VersionChanges version={version} />}
      {update?.note?.fallback && <p className="text-xs text-neutral-600">The note written failed its checks, so readers get the fixed line.</p>}
      {update?.error && <p className="text-sm text-red-700">{update.error}</p>}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details>
      <summary className={SUMMARY}>{title}</summary>
      <div className="mt-2 space-y-2 text-xs text-neutral-700">{children}</div>
    </details>
  )
}

function Searches({ pass, view }: { pass: ResearchPass; view: StoryPasses }) {
  const made = view.pool.searches.filter(s => s.passId === pass.id)
  const skipped = [...(pass.record?.skippedQueries ?? []), ...(pass.record?.context?.skippedSearches ?? []).map(s => `${s.slot}: ${s.query}`)]
  return (
    <Section title={`Searches (${made.length})`}>
      {made.length === 0 ? (
        <p className="text-neutral-500">None made.</p>
      ) : (
        <ul className="list-disc pl-5">
          {made.map((s, i) => (
            <li key={i}>
              {s.kind === 'coverage' ? 'Coverage' : `Gap · ${s.slot ?? 'slot'}${s.angle ? ` (${s.angle})` : ''}`}: {s.query} · {s.results} results, {s.credits}{' '}
              credits{s.cached ? ', cached' : ''}
            </li>
          ))}
        </ul>
      )}
      {skipped.length > 0 && (
        <div>
          <h4 className={H}>Not searched again: an earlier pass made them</h4>
          <ul className="list-disc pl-5">
            {skipped.map(q => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  )
}

function Sources({ pass, view }: { pass: ResearchPass; view: StoryPasses }) {
  const added = view.pool.sources.filter(s => s.firstPassId === pass.id)
  const dropped = view.pool.dropped.filter(d => d.passId === pass.id)
  return (
    <Section title={`Sources (${added.length} new, ${view.pool.sources.length} in the pool)`}>
      {added.length === 0 ? (
        <p className="text-neutral-500">No new source.</p>
      ) : (
        <ul className="space-y-2">
          {added.map(s => (
            <li key={s.id}>
              <p className="font-medium text-neutral-900">
                {s.ref} · {s.outlet}
              </p>
              <p>
                <SafeLink url={s.url} />
              </p>
              <p className="text-neutral-600">{[s.date ?? 'undated', s.kind, s.origin].join(' · ')}</p>
            </li>
          ))}
        </ul>
      )}
      {dropped.length > 0 && (
        <p className="text-neutral-600">
          Read and left out: {dropped.length} ({[...new Set(dropped.map(d => d.reason))].join(', ')})
        </p>
      )}
    </Section>
  )
}

/** Why a fact is shown no more: the facts that contradict it, or an editor's choice. */
function dropReason(f: PoolFactView, reasons: ReadonlyMap<string, string>): string {
  if (f.drop?.reason === 'editor') return 'an editor dropped it'
  const by = f.drop?.contradictedBy.length ? `contradicted by ${f.drop.contradictedBy.join(', ')}` : 'contradicted by newer reporting'
  const why = reasons.get(f.ref)
  return why ? `${by}: ${why}` : by
}

function FactLine({ fact, note }: { fact: PoolFactView; note?: string }) {
  return (
    <li>
      <p>
        <span className="font-mono text-xs text-neutral-500">{fact.ref}</span> {fact.statement}
      </p>
      <p className="text-neutral-600">“{fact.supportingSentence}”</p>
      {note && <p className="text-amber-800">{note}</p>}
    </li>
  )
}

/** The figures the pass's figure check took out of facts it kept, each with why; nothing when it took none. */
function RemovedFigures({ figures }: { figures: RemovedFigure[] }) {
  if (figures.length === 0) return null
  return (
    <div>
      <h4 className={H}>Figures removed: not found in the source</h4>
      <ul className="space-y-2">
        {figures.map(f => (
          <li key={f.ref}>
            <p>
              <RemovedFigureText figure={f} />
            </p>
            <p className="text-amber-800">{REMOVED_FIGURE_REASONS[f.answer]}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Facts({ pass, view }: { pass: ResearchPass; view: StoryPasses }) {
  const facts = view.pool.facts
  const found = facts.filter(f => f.firstPassId === pass.id)
  const checked = facts.filter(f => f.checkedBy?.passId === pass.id)
  const rejected = checked.filter(f => f.verdict === 'rejected')
  const demoted = facts.filter(f => f.drop?.passId === pass.id)
  const reasons = new Map((pass.record?.update?.demoted ?? []).map(d => [d.ref, d.reason]))
  const superseded = pass.record?.update?.superseded ?? []
  return (
    <Section title={`Facts (${found.length} new, ${checked.length} checked, ${rejected.length} rejected, ${demoted.length} demoted)`}>
      <p>
        Checked by this pass: {checked.filter(f => f.verdict === 'supported').length} supported, {rejected.length} rejected,{' '}
        {checked.filter(f => f.verdict === 'unjudged').length} unjudged. A fact is checked once; later passes read its verdict.
      </p>
      {rejected.length > 0 && (
        <div>
          <h4 className={H}>Rejected</h4>
          <ul className="space-y-2">
            {rejected.map(f => (
              <FactLine key={f.id} fact={f} note={f.verdictProblem ?? undefined} />
            ))}
          </ul>
        </div>
      )}
      <RemovedFigures figures={pass.record?.context?.removedFigures ?? []} />
      {demoted.length > 0 && (
        <div>
          <h4 className={H}>Demoted: shown and offered no more</h4>
          <ul className="space-y-2">
            {demoted.map(f => (
              <FactLine key={f.id} fact={f} note={dropReason(f, reasons)} />
            ))}
          </ul>
        </div>
      )}
      {superseded.length > 0 && (
        <p className="text-neutral-600">Kept as past values, a newer value found: {superseded.map(s => `${s.ref} (by ${s.by.join(', ')})`).join('; ')}.</p>
      )}
    </Section>
  )
}

const CARD_WORDS: Record<PassRecord['cards'], string> = {
  written: 'Cards written from the pool.',
  none: 'No card: nothing supported answers a card.',
  failed: 'The cards failed; the article stands.',
  budget: 'The cards were skipped: the budget had no room for them.',
  kept: 'The cards stayed as they were: the pool gained and lost no supported fact.',
}

function Cards({ pass }: { pass: ResearchPass }) {
  const record = pass.record
  if (!record?.cards) return null
  const drops = record.context?.boxDrops ?? []
  return (
    <Section title="Cards">
      <p>
        {CARD_WORDS[record.cards]}
        {record.cardsError ? ` ${record.cardsError}.` : ''} Hide or move the cards shown on the Context tab.
      </p>
      {drops.length > 0 && (
        <ul className="list-disc pl-5">
          {drops.map((d, i) => (
            <li key={i}>
              Dropped {d.label}: {d.cause}
              {d.problem ? `, ${d.problem}` : ''}
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

const causeOf = (p: ResearchProblem) => (p.kind && p.by ? ` (${p.kind}, ${p.by === 'judge' ? 'AI check' : 'code check'})` : '')

function Checks({ pass }: { pass: ResearchPass }) {
  const { problems } = pass
  return (
    <Section title={`Checks (${problems.length} ${problems.length === 1 ? 'problem' : 'problems'})`}>
      {problems.length === 0 ? (
        <p className="text-neutral-500">The checks found nothing.</p>
      ) : (
        <ul className="list-disc pl-5">
          {problems.map((p, i) => (
            <li key={i}>
              {p.label}: {p.problem}
              {causeOf(p)}
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

/** The cost per step, from the calls as the server names them (`pass.calls`): research's and the cards' steps of one name stay apart. */
function Cost({ pass }: { pass: ResearchPass }) {
  const steps = new Map<string, { calls: number; usd: number; models: Set<string> }>()
  for (const c of pass.calls) {
    const line = steps.get(c.step) ?? { calls: 0, usd: 0, models: new Set<string>() }
    line.calls += 1
    line.usd += c.costUsd
    line.models.add(c.model)
    steps.set(c.step, line)
  }
  return (
    <Section title={`Cost (${usd(pass.costUsd)})`}>
      <p>
        Models {usd(pass.modelUsd)}, searches {usd(Math.max(pass.costUsd - pass.modelUsd, 0))} ({pass.tavilyCredits} credits).
      </p>
      {steps.size > 0 && (
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
              <th scope="col" className="pr-3">
                Model
              </th>
              <th scope="col" className="text-right">
                USD
              </th>
            </tr>
          </thead>
          <tbody>
            {[...steps].map(([step, line]) => (
              <tr key={step}>
                <th scope="row" className="pr-3 text-left font-normal">
                  {step}
                </th>
                <td className="pr-3 text-right">{line.calls}</td>
                <td className="pr-3">{[...line.models].join(', ')}</td>
                <td className="text-right">{usd(line.usd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  )
}

/** `singleSourceEmotion`: the story's single-source emotion tag, shown beside the one a first pass gave its text. */
export function ResearchPassView({ pass, view, singleSourceEmotion }: { pass: ResearchPass; view: StoryPasses; singleSourceEmotion?: EmotionTag | null }) {
  const version = view.versions.find(v => v.id === pass.versionId) ?? null
  const outcome = outcomeText(pass)
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <RunTrigger run={pass} />
        <Badge variant="gray">{pass.kind === 'first' ? 'First pass' : 'Later pass'}</Badge>
        {version && (
          <Badge variant={version.status === 'current' ? 'green' : 'gray'}>
            Version {version.number}
            {version.status === 'current' ? ', current' : version.status === 'reverted' ? ', reverted' : ''}
          </Badge>
        )}
      </div>
      <PassStatus pass={pass} />
      {outcome && <p className="text-sm font-medium text-neutral-900">{outcome}</p>}
      <WhatChanged pass={pass} version={version} singleSourceEmotion={singleSourceEmotion} />
      <Searches pass={pass} view={view} />
      <Sources pass={pass} view={view} />
      <Facts pass={pass} view={view} />
      <Cards pass={pass} />
      <Checks pass={pass} />
      <Cost pass={pass} />
    </div>
  )
}

const VERSION_KIND: Record<ArticleVersionView['kind'], string> = { first: 'first pass', update: 'update', legacy: 'from research before passes' }

/** The story's article versions, newest first: each one's number, kind, state and day, and the Update note it made. */
export function ArticleVersions({ versions }: { versions: ArticleVersionView[] }) {
  if (versions.length === 0) return null
  return (
    <Section title={`Versions (${versions.length})`}>
      <ul className="space-y-2">
        {versions.map(v => (
          <li key={v.id}>
            <p className="font-medium text-neutral-900">
              Version {v.number} · {VERSION_KIND[v.kind]} · {v.status} · {formatDateWithTime(v.createdAt)}
            </p>
            {v.title && <p>{v.title}</p>}
            {v.note && <p className="text-neutral-600">Update: {v.note.text}</p>}
          </li>
        ))}
      </ul>
    </Section>
  )
}

const factState = (f: PoolFactView): string =>
  f.status === 'demoted' ? 'demoted' : f.verdict === 'supported' ? 'supported' : f.verdict === 'rejected' ? 'rejected' : 'not checked yet'

const NO_REASONS: ReadonlyMap<string, string> = new Map()

/** The story's whole evidence pool: every source with its facts, each fact's verdict and whether it was demoted. */
export function EvidencePoolView({ view }: { view: StoryPasses }) {
  const { sources, facts } = view.pool
  if (sources.length === 0) return null
  return (
    <Section title={`Evidence pool (${sources.length} sources, ${facts.length} facts)`}>
      {sources.map(s => {
        const own = facts.filter(f => f.sourceRef === s.ref)
        return (
          <div key={s.id}>
            <p className="font-medium text-neutral-900">
              {s.ref} · {s.outlet} · {s.origin}
            </p>
            {own.length === 0 ? (
              <p className="text-neutral-500">No facts.</p>
            ) : (
              <ul className="space-y-1">
                {own.map(f => (
                  <li key={f.id}>
                    <span className="font-mono text-xs text-neutral-500">{f.ref}</span> {f.statement}{' '}
                    <span className={f.status === 'demoted' || f.verdict === 'rejected' ? 'text-amber-800' : 'text-neutral-500'}>
                      ({factState(f)}
                      {f.status === 'demoted' ? `: ${dropReason(f, NO_REASONS)}` : f.verdict === 'rejected' && f.verdictProblem ? `: ${f.verdictProblem}` : ''})
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </Section>
  )
}

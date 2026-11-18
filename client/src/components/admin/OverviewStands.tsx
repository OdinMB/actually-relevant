import type { AdminStandsFact, AdminStandsLine, AdminStandsVersion } from '@shared/types'
import { Badge } from '../ui/Badge'
import { formatDateWithTime, formatShortDate } from '../../lib/constants'

/*
 * An overview's "Where this stands" versions on its admin page, newest first (the current one
 * open): each line with the pool facts it cites as they stand now (verdict, status, source), so a
 * fact demoted or deleted since shows why the public page would drop that line; then the lines the
 * write's checks dropped.
 */

function FactMark({ fact }: { fact: AdminStandsFact }) {
  if (fact.gone) return <Badge variant="red">Deleted since</Badge>
  if (fact.usable) return <Badge variant="green">Supported</Badge>
  return <Badge variant="red">{fact.status === 'demoted' ? 'Demoted' : fact.verdict === 'rejected' ? 'Rejected' : 'Not judged'}</Badge>
}

function Line({ line }: { line: AdminStandsLine }) {
  return (
    <li className="space-y-1">
      <p className="text-sm text-neutral-900">{line.text}</p>
      <ul className="space-y-1 border-l-2 border-neutral-200 pl-3" aria-label="Facts it cites">
        {line.facts.map(f => (
          <li key={f.id} className="flex flex-wrap items-start gap-2 text-xs text-neutral-700">
            <FactMark fact={f} />
            {f.gone ? (
              <span className="font-mono text-neutral-500">{f.id}</span>
            ) : (
              <span className="min-w-0 flex-1">
                {f.statement}{' '}
                <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-brand-700 underline hover:text-brand-800">
                  {f.outlet}
                  <span className="sr-only"> (opens in new tab)</span>
                </a>
              </span>
            )}
          </li>
        ))}
      </ul>
    </li>
  )
}

function Version({ version: v }: { version: AdminStandsVersion }) {
  return (
    <details open={v.status === 'current'} className="rounded-lg border border-neutral-200 bg-white px-4 py-3">
      <summary className="cursor-pointer text-sm font-medium text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded">
        Version {v.number}
        {v.status === 'current' ? ' (current)' : ''}: as of {formatShortDate(v.asOf)}
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs text-neutral-500">
          Written {formatDateWithTime(v.writtenAt)} by {v.model}, prompt {v.promptVersion}. {v.checked} lines checked, {v.failed} dropped.
        </p>
        {v.sentences.length > 0 && (
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Where this stands</h3>
            <ul className="space-y-2">
              {v.sentences.map((l, i) => (
                <Line key={i} line={l} />
              ))}
            </ul>
          </div>
        )}
        {v.doing.length > 0 && (
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">What is being done</h3>
            <ul className="space-y-2">
              {v.doing.map((l, i) => (
                <Line key={i} line={l} />
              ))}
            </ul>
          </div>
        )}
        {v.drops.length > 0 && (
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Dropped by its checks</h3>
            <ul className="space-y-0.5 text-xs text-neutral-700">
              {v.drops.map((d, i) => (
                <li key={i}>
                  {d.label}: {d.cause}
                  {d.problem && <span className="text-neutral-500"> ({d.problem})</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  )
}

export function OverviewStands({ versions }: { versions: AdminStandsVersion[] }) {
  return (
    <section aria-labelledby="overview-stands" className="space-y-3">
      <h2 id="overview-stands" className="text-lg font-semibold text-neutral-900">
        Where this stands
      </h2>
      {versions.length === 0 ? (
        <p className="text-sm text-neutral-500">Not written yet.</p>
      ) : (
        <div className="space-y-2">
          {versions.map(v => (
            <Version key={v.id} version={v} />
          ))}
        </div>
      )}
    </section>
  )
}

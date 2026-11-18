import { type FocusEvent, type KeyboardEvent } from 'react'
import { Helmet } from 'react-helmet-async'
import type { SpendingGroup, SpendingOverview, SpendingRow } from '@shared/types'
import { useSetSpendLevel, useSpending } from '../../hooks/useSpending'
import { jobDisplayName } from '../../lib/constants'
import { formatUsd, spendMonthName as monthName } from '../../lib/jobRun'
import { FIELD_FOCUS } from '../../lib/control-classes'
import { ApiError } from '../../lib/admin-api'
import { useToast } from '../../components/ui/Toast'
import { Badge } from '../../components/ui/Badge'
import { LoadingSpinner } from '../../components/ui/LoadingSpinner'
import { ErrorState } from '../../components/ui/ErrorState'
import { PageHeader } from '../../components/ui/PageHeader'

/**
 * The Spending page (`.context/admin-dashboard.md`): every job that spends money, grouped
 * as on the Jobs page, with this month's AI and web search spend, the month at this pace, the two
 * months before and each warning level, which saves when its field loses focus. The server decides
 * the rows, their order and whether a level is passed or heading past at this pace.
 */

const COLUMNS = 8

const rowLabel = (scope: SpendingRow['scope']) =>
  scope === 'all' ? 'All jobs' : scope === 'editor_research' ? 'Research started by an editor' : jobDisplayName(scope)

/** A level as its field shows it: "$25", or empty for none. */
const levelText = (levelUsd: number | null) => (levelUsd === null ? '' : `$${levelUsd.toLocaleString('en-US')}`)

/** What a level field holds: whole dollars ("$25", "1,200"), null when empty, undefined for anything else. */
function parseLevel(text: string): number | null | undefined {
  const digits = text.trim().replace(/^\$/, '').replace(/,/g, '').trim()
  if (digits === '' || digits.toLowerCase() === 'none') return null
  if (!/^\d+$/.test(digits)) return undefined
  const level = Number(digits)
  return level >= 1 ? level : undefined
}

const NUMBER_CELL = 'px-3 py-2 text-right tabular-nums whitespace-nowrap'

function UsdCell({ usd, strong = false }: { usd: number; strong?: boolean }) {
  if (usd === 0) return <td className={`${NUMBER_CELL} text-neutral-400`}>—</td>
  return <td className={`${NUMBER_CELL} ${strong ? 'font-semibold text-neutral-900' : 'text-neutral-700'}`}>{formatUsd(usd)}</td>
}

function PaceCell({ row }: { row: SpendingRow }) {
  if (!row.warning) return <UsdCell usd={row.paceUsd} />
  return (
    <td className={`${NUMBER_CELL} font-semibold text-amber-700`}>
      {formatUsd(row.paceUsd)}
      <Badge variant="yellow" className="ml-1.5">
        {row.warning === 'passed' ? `passed $${row.levelUsd ?? ''}` : 'on pace to pass'}
      </Badge>
    </td>
  )
}

function LevelField({ row, label }: { row: SpendingRow; label: string }) {
  const setLevel = useSetSpendLevel()
  const { toast } = useToast()
  const id = `warn-at-${row.scope}`
  const shown = levelText(row.levelUsd)

  const save = (e: FocusEvent<HTMLInputElement>) => {
    const field = e.currentTarget
    const levelUsd = parseLevel(field.value)
    if (levelUsd === undefined) {
      field.value = shown
      toast('error', 'A warning level is a whole number of dollars, at least $1. Leave the field empty for none.')
      return
    }
    if (levelUsd === row.levelUsd) {
      field.value = shown
      return
    }
    setLevel.mutate(
      { scope: row.scope, levelUsd },
      {
        onSuccess: () => toast('success', levelUsd === null ? `No warning level for ${label}` : `${label}: warning at $${levelUsd.toLocaleString('en-US')}`),
        onError: err => {
          field.value = shown
          toast('error', err instanceof ApiError ? err.message : 'Failed to save the warning level')
        },
      },
    )
  }
  const blurOnEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur()
  }

  return (
    <td className="px-3 py-1.5 text-right">
      <label htmlFor={id} className="sr-only">
        Warning level for {row.scope === 'all' ? 'all jobs' : label}
      </label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="none"
        defaultValue={shown}
        key={shown}
        disabled={setLevel.isPending}
        onBlur={save}
        onKeyDown={blurOnEnter}
        className={`w-20 rounded-md border border-neutral-500 bg-white px-2 py-1 text-right text-sm tabular-nums text-neutral-900 placeholder:text-neutral-500 ${FIELD_FOCUS}`}
      />
    </td>
  )
}

function SpendRowView({ row }: { row: SpendingRow }) {
  const label = rowLabel(row.scope)
  const total = row.scope === 'all'
  return (
    <tr className={total ? 'border-t-2 border-neutral-200 bg-amber-50' : 'border-b border-neutral-100'}>
      <th scope="row" className={`py-2 pr-3 text-left ${total ? 'pl-3 font-semibold text-neutral-900' : 'pl-6 font-normal text-neutral-900'}`}>
        {label}
      </th>
      <UsdCell usd={row.thisMonth.aiUsd} strong={total} />
      <UsdCell usd={row.thisMonth.searchUsd} strong={total} />
      <UsdCell usd={row.thisMonth.totalUsd} strong />
      <PaceCell row={row} />
      <UsdCell usd={row.previousUsd[0]} strong={total} />
      <UsdCell usd={row.previousUsd[1]} strong={total} />
      <LevelField row={row} label={label} />
    </tr>
  )
}

/** The podcast's voices are on a plan, not billed per use: their line goes with the group that voices episodes. */
const voicesGroup = (groups: SpendingGroup[]) =>
  groups.find(group => group.rows.some(row => row.scope === 'generate_podcast' || row.scope === 'generate_uplifting_podcast')) ?? groups[groups.length - 1]

function SpendingTable({ data }: { data: SpendingOverview }) {
  const withVoices = voicesGroup(data.groups)
  const { usedChars, capChars } = data.voices
  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <caption className="sr-only">Spending per job this month, at this pace and in the two months before, with each warning level</caption>
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50">
              <th scope="col" className="px-3 py-2 text-left font-medium text-neutral-500">
                Job
              </th>
              {['AI', 'Web search', 'This month', 'Month at this pace', ...data.previousMonths.map(monthName), 'Warn at'].map(name => (
                <th key={name} scope="col" className="whitespace-nowrap px-3 py-2 text-right font-medium text-neutral-500">
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          {data.groups.map(group => (
            <tbody key={group.chain ?? 'other'}>
              <tr className="border-b border-neutral-100 bg-neutral-50">
                <th scope="rowgroup" colSpan={COLUMNS} className="px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-600">
                  {group.chain ? jobDisplayName(group.chain) : 'Other'}
                </th>
              </tr>
              {group.rows.map(row => (
                <SpendRowView key={row.scope} row={row} />
              ))}
              {group === withVoices && (
                <tr className="border-b border-neutral-100">
                  <td colSpan={COLUMNS} className="py-2 pl-6 pr-3 text-left text-xs text-neutral-500">
                    Voices are on the ElevenLabs plan, not billed per use: {usedChars.toLocaleString('en-US')} of the podcast’s{' '}
                    {capChars.toLocaleString('en-US')} characters this month.
                  </td>
                </tr>
              )}
            </tbody>
          ))}
          <tfoot>
            <SpendRowView row={data.total} />
          </tfoot>
        </table>
      </div>
      <p className="border-t border-neutral-100 px-3 py-2.5 text-xs text-neutral-500">
        Passing a warning level, or heading past it at this pace, records a notice once a month. AI actions started from the admin, such as bulk re-assessing,
        are not counted yet.
      </p>
    </div>
  )
}

export default function SpendingPage() {
  const query = useSpending()
  const data = query.data

  return (
    <>
      <Helmet>
        <title>Spending — Admin — Actually Relevant</title>
      </Helmet>
      <PageHeader
        title="Spending"
        description={data ? `${monthName(data.month)} so far (${data.day} of ${data.daysInMonth} days)` : 'This month per job, with the two months before'}
      />
      {query.isLoading && (
        <div className="flex justify-center py-8">
          <LoadingSpinner />
        </div>
      )}
      {query.error && <ErrorState message="Failed to load spending" onRetry={() => query.refetch()} />}
      {data && <SpendingTable data={data} />}
    </>
  )
}

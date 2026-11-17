import { useState, type ReactNode, type ThHTMLAttributes } from 'react'
import { ChevronDownIcon, ChevronUpDownIcon, ChevronUpIcon } from '@heroicons/react/20/solid'

export type SortDirection = 'asc' | 'desc'
export type SortValue = string | number | null | undefined

export interface SortState<K extends string> {
  key: K
  direction: SortDirection
}

/**
 * How a column sorts: the value to compare, and the direction of its first click.
 * Without `firstDirection`, numbers start largest first and text starts A to Z.
 */
export interface SortColumn<T> {
  value: (row: T) => SortValue
  firstDirection?: SortDirection
}

export type SortColumns<T, K extends string> = Record<K, SortColumn<T>>

const isEmpty = (v: SortValue): v is null | undefined | '' => v === null || v === undefined || v === ''

function compareValues(a: SortValue, b: SortValue): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), 'en', { sensitivity: 'base', numeric: true })
}

/**
 * A comparator for one sort state. Empty values (null, undefined, '') always go last,
 * whatever the direction; equal values keep the order the rows came in.
 */
export function compareBy<T, K extends string>(columns: SortColumns<T, K>, sort: SortState<K> | null): (a: T, b: T) => number {
  if (!sort) return () => 0
  const { value } = columns[sort.key]
  const sign = sort.direction === 'asc' ? 1 : -1
  return (a, b) => {
    const va = value(a)
    const vb = value(b)
    if (isEmpty(va) || isEmpty(vb)) return isEmpty(va) === isEmpty(vb) ? 0 : isEmpty(va) ? 1 : -1
    return sign * compareValues(va, vb)
  }
}

function firstDirectionFor<T>(column: SortColumn<T>, rows: readonly T[]): SortDirection {
  if (column.firstDirection) return column.firstDirection
  for (const row of rows) {
    const v = column.value(row)
    if (!isEmpty(v)) return typeof v === 'number' ? 'desc' : 'asc'
  }
  return 'asc'
}

/**
 * Client-side sorting for a table whose rows are all loaded. Clicking a new column sorts by it
 * in its first direction; clicking the sorted column again flips it. `initial` null keeps the
 * rows in the order they came in until someone picks a column.
 */
export function useSortableRows<T, K extends string>(rows: readonly T[], columns: SortColumns<T, K>, initial: SortState<NoInfer<K>> | null) {
  const [sort, setSort] = useState<SortState<K> | null>(initial)
  const compare = compareBy(columns, sort)
  const sorted = sort ? [...rows].sort(compare) : [...rows]
  const sortBy = (key: K) =>
    setSort(prev =>
      prev?.key === key ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: firstDirectionFor(columns[key], rows) },
    )
  return { rows: sorted, sort, sortBy, compare }
}

interface SortableHeaderProps<K extends string> extends Omit<ThHTMLAttributes<HTMLTableCellElement>, 'onClick'> {
  column: K
  sort: SortState<K> | null
  onSort: (key: K) => void
  /** Right-aligned headers put the arrow first, so the label lines up with the numbers below. */
  align?: 'left' | 'center' | 'right'
  children: ReactNode
}

/** A column header that sorts its table: a button inside the `th`, with `aria-sort` on the `th`. */
export function SortableHeader<K extends string>({ column, sort, onSort, align = 'left', className = '', children, ...th }: SortableHeaderProps<K>) {
  const active = sort?.key === column
  const direction = active ? sort.direction : null
  const Icon = direction === 'asc' ? ChevronUpIcon : direction === 'desc' ? ChevronDownIcon : ChevronUpDownIcon
  const icon = <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-neutral-700' : 'text-neutral-300 group-hover:text-neutral-500'}`} aria-hidden="true" />
  const alignClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'

  return (
    <th
      scope="col"
      aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'}
      className={`${alignClass} ${className}`}
      {...th}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={`group inline-flex items-center align-middle gap-0.5 rounded hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${active ? 'text-neutral-900' : ''}`}
      >
        {align === 'right' && icon}
        {children}
        {align !== 'right' && icon}
      </button>
    </th>
  )
}

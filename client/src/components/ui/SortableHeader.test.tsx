import { describe, it, expect } from 'vitest'
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { SortableHeader, compareBy, useSortableRows, type SortColumns } from './SortableHeader'

interface Row {
  name: string
  count: number | null
}

const columns: SortColumns<Row, 'name' | 'count'> = {
  name: { value: r => r.name },
  count: { value: r => r.count },
}

const rows: Row[] = [
  { name: 'beta', count: 2 },
  { name: 'Alpha', count: null },
  { name: 'gamma 10', count: 10 },
  { name: 'gamma 9', count: 2 },
]

const names = (list: Row[]) => list.map(r => r.name)

describe('compareBy', () => {
  it('sorts text case-insensitively with numbers in natural order', () => {
    expect(names([...rows].sort(compareBy(columns, { key: 'name', direction: 'asc' })))).toEqual(['Alpha', 'beta', 'gamma 9', 'gamma 10'])
  })

  it('keeps empty values last in both directions and ties in their incoming order', () => {
    expect(names([...rows].sort(compareBy(columns, { key: 'count', direction: 'desc' })))).toEqual(['gamma 10', 'beta', 'gamma 9', 'Alpha'])
    expect(names([...rows].sort(compareBy(columns, { key: 'count', direction: 'asc' })))).toEqual(['beta', 'gamma 9', 'gamma 10', 'Alpha'])
  })
})

describe('useSortableRows', () => {
  it('keeps the incoming order until a column is picked', () => {
    const { result } = renderHook(() => useSortableRows(rows, columns, null))
    expect(names(result.current.rows)).toEqual(names(rows))
    expect(result.current.sort).toBeNull()
  })

  it('starts numbers largest first and text A to Z, and flips on a second click', () => {
    const { result } = renderHook(() => useSortableRows(rows, columns, null))
    act(() => result.current.sortBy('count'))
    expect(result.current.sort).toEqual({ key: 'count', direction: 'desc' })
    act(() => result.current.sortBy('name'))
    expect(result.current.sort).toEqual({ key: 'name', direction: 'asc' })
    act(() => result.current.sortBy('name'))
    expect(result.current.sort).toEqual({ key: 'name', direction: 'desc' })
    expect(names(result.current.rows)).toEqual(['gamma 10', 'gamma 9', 'beta', 'Alpha'])
  })

  it('honors a column’s own first direction', () => {
    const cols: SortColumns<Row, 'count'> = { count: { value: r => r.count, firstDirection: 'asc' } }
    const { result } = renderHook(() => useSortableRows(rows, cols, null))
    act(() => result.current.sortBy('count'))
    expect(result.current.sort).toEqual({ key: 'count', direction: 'asc' })
  })
})

describe('SortableHeader', () => {
  function Table() {
    const { rows: sorted, sort, sortBy } = useSortableRows(rows, columns, { key: 'name', direction: 'asc' })
    return (
      <table>
        <thead>
          <tr>
            <SortableHeader column="name" sort={sort} onSort={sortBy}>
              Name
            </SortableHeader>
            <SortableHeader column="count" sort={sort} onSort={sortBy} align="right">
              Count
            </SortableHeader>
          </tr>
        </thead>
        <tbody>
          {sorted.map(r => (
            <tr key={r.name}>
              <td>{r.name}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  it('marks the sorted column with aria-sort and resorts on click', () => {
    render(<Table />)
    expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveAttribute('aria-sort', 'ascending')
    expect(screen.getByRole('columnheader', { name: 'Count' })).toHaveAttribute('aria-sort', 'none')

    fireEvent.click(screen.getByRole('button', { name: 'Count' }))
    expect(screen.getByRole('columnheader', { name: 'Count' })).toHaveAttribute('aria-sort', 'descending')
    expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveAttribute('aria-sort', 'none')
    expect(screen.getAllByRole('cell').map(c => c.textContent)).toEqual(['gamma 10', 'beta', 'gamma 9', 'Alpha'])
  })
})

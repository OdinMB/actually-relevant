import type { Newsletter } from '@shared/types'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { SortableHeader, useSortableRows, type SortColumns } from '../ui/SortableHeader'
import { TimeWithRelative } from './TimeWithRelative'
import { BRAND } from '../../config'

interface NewsletterTableProps {
  newsletters: Newsletter[]
  onView: (id: string) => void
  onDelete: (id: string) => void
}

type NewsletterSortKey = 'title' | 'status' | 'stories' | 'created'

const COLUMNS: SortColumns<Newsletter, NewsletterSortKey> = {
  title: { value: n => n.title },
  status: { value: n => n.status },
  stories: { value: n => n.storyIds.length },
  created: { value: n => n.createdAt, firstDirection: 'desc' },
}

const TH = 'px-3 py-2 font-medium text-neutral-500'

export function NewsletterTable({ newsletters, onView, onDelete }: NewsletterTableProps) {
  const { rows, sort, sortBy } = useSortableRows(newsletters, COLUMNS, null)
  const header = { sort, onSort: sortBy }

  return (
    <div className="overflow-x-auto bg-white rounded-lg border border-neutral-200 shadow-sm">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-200 bg-neutral-50">
            <SortableHeader column="title" {...header} className={TH}>
              Title
            </SortableHeader>
            <SortableHeader column="status" {...header} className={TH}>
              Status
            </SortableHeader>
            <SortableHeader column="stories" {...header} className={TH}>
              Stories
            </SortableHeader>
            <SortableHeader column="created" {...header} className={TH}>
              Created
            </SortableHeader>
            <th scope="col" className="text-right px-3 py-2 font-medium text-neutral-500">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(nl => (
            <tr key={nl.id} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
              <td className="px-3 py-2">
                <button
                  onClick={() => onView(nl.id)}
                  className="font-medium text-neutral-900 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded"
                >
                  {nl.title}
                </button>
                {nl.edition === 'uplifting' && (
                  <Badge variant="pink" className="ml-2">
                    {BRAND.upliftingEdition}
                  </Badge>
                )}
              </td>
              <td className="px-3 py-2">
                <Badge variant={nl.status === 'published' ? 'green' : 'gray'}>{nl.status === 'published' ? 'Published' : 'Draft'}</Badge>
              </td>
              <td className="px-3 py-2 text-neutral-600">{nl.storyIds.length}</td>
              <td className="px-3 py-2 text-neutral-500 whitespace-nowrap">
                <TimeWithRelative dateStr={nl.createdAt} />
              </td>
              <td className="px-3 py-2 text-right">
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" size="sm" onClick={() => onView(nl.id)}>
                    View
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => onDelete(nl.id)} className="text-red-600 hover:text-red-700">
                    Delete
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

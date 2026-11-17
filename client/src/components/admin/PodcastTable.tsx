import type { PodcastListItem } from '@shared/types'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { SortableHeader, useSortableRows, type SortColumns } from '../ui/SortableHeader'
import { BRAND } from '../../config'
import { formatDate } from '../../lib/constants'
import { PodcastStageBadge } from './PodcastStageBadge'
import { PodcastStatusBadge } from './PodcastStatusBadge'

interface PodcastTableProps {
  podcasts: PodcastListItem[]
  onView: (id: string) => void
  onDelete: (id: string) => void
}

type PodcastSortKey = 'title' | 'week' | 'stories' | 'created'

const COLUMNS: SortColumns<PodcastListItem, PodcastSortKey> = {
  title: { value: p => p.title },
  week: { value: p => (p.kind === 'standalone' ? null : p.weekKey), firstDirection: 'desc' },
  stories: { value: p => p.storyIds.length },
  created: { value: p => p.createdAt, firstDirection: 'desc' },
}

const TH = 'text-left px-3 py-2 font-medium text-neutral-500'

export function PodcastTable({ podcasts, onView, onDelete }: PodcastTableProps) {
  const { rows, sort, sortBy } = useSortableRows(podcasts, COLUMNS, null)
  const header = { sort, onSort: sortBy }

  return (
    <div className="overflow-x-auto bg-white rounded-lg border border-neutral-200 shadow-sm">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-200 bg-neutral-50">
            <SortableHeader column="title" {...header} className={TH}>
              Title
            </SortableHeader>
            <SortableHeader column="week" {...header} className={TH}>
              Week
            </SortableHeader>
            {/* Stage and status are derived badges with no natural order, so they don't sort */}
            <th scope="col" className={TH}>
              Stage
            </th>
            <th scope="col" className={TH}>
              Status
            </th>
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
          {rows.map(pod => (
            <tr key={pod.id} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
              <td className="px-3 py-2">
                <button
                  onClick={() => onView(pod.id)}
                  className="font-medium text-neutral-900 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded"
                >
                  {pod.title}
                </button>
              </td>
              <td className="px-3 py-2 text-neutral-600 whitespace-nowrap">
                {pod.kind === 'standalone' ? 'Standalone' : (pod.weekKey ?? '—')}
                {pod.edition === 'uplifting' && (
                  <Badge variant="pink" className="ml-2">
                    {BRAND.upliftingEdition}
                  </Badge>
                )}
              </td>
              <td className="px-3 py-2">
                <PodcastStageBadge podcast={pod} />
              </td>
              <td className="px-3 py-2">
                <PodcastStatusBadge podcast={pod} />
              </td>
              <td className="px-3 py-2 text-neutral-600">{pod.storyIds.length}</td>
              <td className="px-3 py-2 text-neutral-500 whitespace-nowrap">{formatDate(pod.createdAt)}</td>
              <td className="px-3 py-2 text-right">
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" size="sm" onClick={() => onView(pod.id)}>
                    View
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => onDelete(pod.id)} className="text-red-600 hover:text-red-700">
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

import { Menu, MenuButton, MenuItems, MenuItem } from '@headlessui/react'
import { EllipsisVerticalIcon, PencilSquareIcon, TrashIcon } from '@heroicons/react/24/outline'
import type { StoryCluster } from '@shared/types'
import { ActionIconButton } from '../ui/ActionIconButton'
import { SortableHeader, useSortableRows, type SortColumns } from '../ui/SortableHeader'
import { TimeWithRelative } from './TimeWithRelative'

interface ClusterTableProps {
  clusters: StoryCluster[]
  onEdit: (id: string) => void
  onDissolve: (id: string) => void
}

type ClusterSortKey = 'primary' | 'members' | 'created'

const primaryTitle = (cluster: StoryCluster) => cluster.primaryStory?.title || cluster.primaryStory?.sourceTitle || 'No primary'

const COLUMNS: SortColumns<StoryCluster, ClusterSortKey> = {
  primary: { value: primaryTitle },
  members: { value: c => c._count.stories },
  created: { value: c => c.createdAt, firstDirection: 'desc' },
}

const TH = 'px-3 py-2 font-medium text-neutral-500'

export function ClusterTable({ clusters, onEdit, onDissolve }: ClusterTableProps) {
  const { rows, sort, sortBy } = useSortableRows(clusters, COLUMNS, null)
  const header = { sort, onSort: sortBy }

  return (
    <div className="overflow-x-auto bg-white rounded-lg border border-neutral-200 shadow-sm">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-200 bg-neutral-50">
            <SortableHeader column="primary" {...header} className={TH}>
              Primary Story
            </SortableHeader>
            <SortableHeader column="members" {...header} align="center" className={`hidden md:table-cell ${TH}`}>
              Members
            </SortableHeader>
            <SortableHeader column="created" {...header} className={`hidden md:table-cell ${TH}`}>
              Created
            </SortableHeader>
            <th scope="col" className="px-3 py-2 text-right font-medium text-neutral-500">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(cluster => {
            return (
              <tr key={cluster.id} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
                <td className="px-3 py-2">
                  <button
                    onClick={() => onEdit(cluster.id)}
                    className="text-left font-medium text-neutral-900 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded"
                  >
                    {primaryTitle(cluster)}
                  </button>
                  {/* Mobile metadata */}
                  <div className="flex flex-wrap items-center gap-1.5 mt-1 md:hidden">
                    <span className="inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
                      {cluster._count.stories} stories
                    </span>
                    <span className="text-neutral-500 text-xs">
                      <TimeWithRelative dateStr={cluster.createdAt} />
                    </span>
                  </div>
                </td>
                <td className="hidden md:table-cell px-3 py-2 text-center">
                  <span className="inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
                    {cluster._count.stories}
                  </span>
                </td>
                <td className="hidden md:table-cell px-3 py-2 text-neutral-500 whitespace-nowrap">
                  <TimeWithRelative dateStr={cluster.createdAt} />
                </td>
                <td className="px-3 py-2">
                  {/* Desktop actions */}
                  <div className="hidden md:flex items-center justify-end gap-0.5">
                    <ActionIconButton icon={PencilSquareIcon} label="Edit" onClick={() => onEdit(cluster.id)} />
                    <ActionIconButton icon={TrashIcon} label="Dissolve" variant="danger" onClick={() => onDissolve(cluster.id)} />
                  </div>

                  {/* Mobile overflow menu */}
                  <div className="md:hidden flex justify-end">
                    <Menu as="div" className="relative">
                      <MenuButton className="rounded p-1 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                        <EllipsisVerticalIcon className="h-5 w-5 text-neutral-400" />
                      </MenuButton>
                      <MenuItems className="absolute right-0 z-10 mt-1 w-40 rounded-md bg-white shadow-lg border border-neutral-200 py-1 focus:outline-none">
                        <MenuItem>
                          <button
                            onClick={() => onEdit(cluster.id)}
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-neutral-700 data-[focus]:bg-neutral-100"
                          >
                            <PencilSquareIcon className="h-4 w-4 shrink-0" />
                            Edit
                          </button>
                        </MenuItem>
                        <MenuItem>
                          <button
                            onClick={() => onDissolve(cluster.id)}
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-red-600 data-[focus]:bg-red-50"
                          >
                            <TrashIcon className="h-4 w-4 shrink-0" />
                            Dissolve
                          </button>
                        </MenuItem>
                      </MenuItems>
                    </Menu>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

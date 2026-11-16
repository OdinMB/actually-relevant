import { Menu, MenuButton, MenuItems, MenuItem } from '@headlessui/react'
import { EllipsisVerticalIcon, PencilSquareIcon, TrashIcon } from '@heroicons/react/24/outline'
import type { Issue } from '@shared/types'
import { ActionIconButton } from '../ui/ActionIconButton'
import { SortableHeader, useSortableRows, type SortColumns } from '../ui/SortableHeader'

interface IssueTableProps {
  issues: Issue[]
  onEdit: (id: string) => void
  onDelete: (id: string) => void
}

type IssueSortKey = 'name' | 'slug' | 'published'

const COLUMNS: SortColumns<Issue, IssueSortKey> = {
  name: { value: i => i.name },
  slug: { value: i => i.slug },
  published: { value: i => i.publishedStoryCount ?? 0 },
}

const TH = 'px-3 py-2 font-medium text-neutral-500'

/** Parents in sort order, each followed by its children (indented), also in sort order. */
function buildHierarchicalList(issues: Issue[], compare: (a: Issue, b: Issue) => number): { issue: Issue; isChild: boolean }[] {
  const parents = issues.filter(i => !i.parentId).sort(compare)
  const childrenByParent = new Map<string, Issue[]>()
  for (const issue of issues) {
    if (issue.parentId) {
      const list = childrenByParent.get(issue.parentId) || []
      list.push(issue)
      childrenByParent.set(issue.parentId, list)
    }
  }

  const rows: { issue: Issue; isChild: boolean }[] = []
  for (const parent of parents) {
    rows.push({ issue: parent, isChild: false })
    const children = childrenByParent.get(parent.id) || []
    children.sort(compare)
    for (const child of children) {
      rows.push({ issue: child, isChild: true })
    }
  }
  return rows
}

export function IssueTable({ issues, onEdit, onDelete }: IssueTableProps) {
  const { sort, sortBy, compare } = useSortableRows(issues, COLUMNS, { key: 'name', direction: 'asc' })
  const rows = buildHierarchicalList(issues, compare)
  const header = { sort, onSort: sortBy }

  return (
    <div className="overflow-x-auto bg-white rounded-lg border border-neutral-200 shadow-sm">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-200 bg-neutral-50">
            <SortableHeader column="name" {...header} className={TH}>
              Name
            </SortableHeader>
            <SortableHeader column="slug" {...header} className={`hidden md:table-cell ${TH}`}>
              Slug
            </SortableHeader>
            <SortableHeader column="published" {...header} className={`hidden md:table-cell ${TH}`}>
              Published
            </SortableHeader>
            <th scope="col" className="px-3 py-2 text-right font-medium text-neutral-500">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ issue, isChild }) => (
            <tr key={issue.id} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
              <td className="px-3 py-2">
                {isChild && <span className="text-neutral-400 mr-1.5">└</span>}
                <button
                  onClick={() => onEdit(issue.id)}
                  className="text-left font-medium text-neutral-900 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded"
                >
                  {issue.name}
                </button>
                {/* Mobile metadata */}
                <div className="flex flex-wrap items-center gap-1.5 mt-1 md:hidden">
                  <span className="text-neutral-500 text-xs font-mono">{issue.slug}</span>
                  <span className="text-neutral-400 text-xs">{issue.publishedStoryCount ?? 0} published</span>
                </div>
              </td>
              <td className="hidden md:table-cell px-3 py-2 text-neutral-500 font-mono text-xs">{issue.slug}</td>
              <td className="hidden md:table-cell px-3 py-2 text-neutral-500 whitespace-nowrap">{issue.publishedStoryCount ?? 0}</td>
              <td className="px-3 py-2">
                {/* Desktop actions */}
                <div className="hidden md:flex items-center justify-end gap-0.5">
                  <ActionIconButton icon={PencilSquareIcon} label="Edit" onClick={() => onEdit(issue.id)} />
                  <ActionIconButton icon={TrashIcon} label="Delete" variant="danger" onClick={() => onDelete(issue.id)} />
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
                          onClick={() => onEdit(issue.id)}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-neutral-700 data-[focus]:bg-neutral-100"
                        >
                          <PencilSquareIcon className="h-4 w-4 shrink-0" />
                          Edit
                        </button>
                      </MenuItem>
                      <MenuItem>
                        <button
                          onClick={() => onDelete(issue.id)}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-red-600 data-[focus]:bg-red-50"
                        >
                          <TrashIcon className="h-4 w-4 shrink-0" />
                          Delete
                        </button>
                      </MenuItem>
                    </MenuItems>
                  </Menu>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

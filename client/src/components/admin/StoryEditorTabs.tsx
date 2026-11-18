import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { Tab, TabGroup, TabList, TabPanel, TabPanels } from '@headlessui/react'
import { ExclamationCircleIcon } from '@heroicons/react/20/solid'
import { CLEAR_OF_STICKY_BARS, STICKY_TAB_LIST, revealPanels } from './stickyTabList'
import { STORY_TAB_LABELS, type StoryTab, type TabMark } from './storyTabs'

const MARK_TEXT: Record<NonNullable<TabMark>, string> = { error: 'has a problem', unsaved: 'unsaved changes' }

function Mark({ mark }: { mark: TabMark }) {
  if (mark === 'error') return <ExclamationCircleIcon className="h-4 w-4 shrink-0 text-red-600" aria-hidden="true" data-mark="error" />
  if (mark === 'unsaved') return <span className="h-2 w-2 shrink-0 rounded-full bg-amber-600" aria-hidden="true" data-mark="unsaved" />
  return null
}

interface StoryEditorTabsProps {
  /** The story's tabs, in order (`availableTabs`). */
  tabs: readonly StoryTab[]
  selected: StoryTab
  marks: Record<StoryTab, TabMark>
  onSelect: (tab: StoryTab) => void
  panels: Record<StoryTab, ReactNode>
}

/**
 * The story page's sections as tabs (WAI-ARIA tabs through Headless UI: arrow keys, Home, End). A
 * tab holding unsaved edits shows a dot, one with a problem an icon, each in words in the tab's name
 * for screen readers. Every panel stays mounted, so the form's fields, a section's open disclosure or chosen
 * run survive a switch; the selection is controlled, the page keeping it in the address. The list
 * stays pinned at the top of the view while the page scrolls, and a switch made further down brings
 * the new panel's top back into sight below it (`stickyTabList.ts`).
 */
export function StoryEditorTabs({ tabs, selected, marks, onSelect, panels }: StoryEditorTabsProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const panelsRef = useRef<HTMLDivElement>(null)
  // Only a switch moves the page: the first tab shows wherever the page was left (Back restores it)
  const shownRef = useRef(selected)
  useLayoutEffect(() => {
    if (shownRef.current === selected) return
    shownRef.current = selected
    if (listRef.current && panelsRef.current) revealPanels(listRef.current, panelsRef.current)
  }, [selected])

  return (
    <TabGroup selectedIndex={Math.max(0, tabs.indexOf(selected))} onChange={i => onSelect(tabs[i]!)}>
      {/* Scrolls sideways on a phone rather than wrapping, the page itself never does */}
      <TabList
        ref={listRef}
        aria-label="Story sections"
        className={`${STICKY_TAB_LIST} -mx-4 flex gap-1 overflow-x-auto border-b border-neutral-200 px-4 lg:-mx-6 lg:px-6`}
      >
        {tabs.map(tab => {
          const mark = marks[tab]
          return (
            <Tab
              key={tab}
              aria-label={mark ? `${STORY_TAB_LABELS[tab]}, ${MARK_TEXT[mark]}` : undefined}
              className="-mb-px inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-t-md border-b-2 border-transparent px-4 py-2 text-sm font-medium text-neutral-600
                hover:text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500
                data-[selected]:border-brand-700 data-[selected]:text-brand-800"
            >
              {STORY_TAB_LABELS[tab]}
              <Mark mark={mark} />
            </Tab>
          )
        })}
      </TabList>
      <TabPanels ref={panelsRef} className={`pt-4 ${CLEAR_OF_STICKY_BARS}`}>
        {tabs.map(tab => (
          <TabPanel key={tab} unmount={false} className="max-w-4xl space-y-6 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
            {panels[tab]}
          </TabPanel>
        ))}
      </TabPanels>
    </TabGroup>
  )
}

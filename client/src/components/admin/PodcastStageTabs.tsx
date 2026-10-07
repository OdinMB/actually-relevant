import type { ReactNode } from 'react'
import { Tab, TabGroup, TabList, TabPanel, TabPanels } from '@headlessui/react'
import { CheckCircleIcon, ExclamationTriangleIcon, EyeIcon, LockClosedIcon } from '@heroicons/react/20/solid'
import type { Podcast } from '@shared/types'
import { PODCAST_TABS, tabState } from './podcastTabs'
import type { PodcastTab, TabState } from './podcastTabs'

const LABEL: Record<PodcastTab, string> = { stories: 'Stories', script: 'Script', audio: 'Audio' }

const STATE_TEXT: Record<TabState, string> = {
  done: 'done',
  running: 'running',
  review: 'waiting for your review',
  error: 'failed',
  next: 'next step',
  locked: 'not reached yet',
}

function StateIcon({ state }: { state: TabState }) {
  const cls = 'h-4 w-4 shrink-0'
  switch (state) {
    case 'done': return <CheckCircleIcon className={`${cls} text-brand-700`} aria-hidden="true" />
    case 'running': return (
      <svg className={`${cls} animate-spin text-brand-600`} viewBox="0 0 24 24" fill="none" aria-hidden="true" data-state="running">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    )
    case 'review': return <EyeIcon className={`${cls} text-orange-600`} aria-hidden="true" />
    case 'error': return <ExclamationTriangleIcon className={`${cls} text-red-600`} aria-hidden="true" />
    case 'locked': return <LockClosedIcon className={`${cls} text-neutral-400`} aria-hidden="true" />
    case 'next': return <span className={`${cls} rounded-full border-2 border-neutral-400`} aria-hidden="true" />
  }
}

interface PodcastStageTabsProps {
  podcast: Podcast
  selected: PodcastTab
  onSelect: (tab: PodcastTab) => void
  panels: Record<PodcastTab, ReactNode>
}

/**
 * The production stages as tabs (WAI-ARIA tabs through Headless UI: arrow keys, Home, End), each
 * label with its progress icon and the state in words for screen readers. A stage not reached yet
 * is a disabled tab whose tooltip says why. The selection is controlled, so the page can ask before
 * a switch that would discard unsaved edits.
 */
export function PodcastStageTabs({ podcast, selected, onSelect, panels }: PodcastStageTabsProps) {
  const states = PODCAST_TABS.map(def => tabState(podcast, def))
  const index = PODCAST_TABS.findIndex(def => def.tab === selected)

  return (
    <TabGroup selectedIndex={index} onChange={i => onSelect(PODCAST_TABS[i].tab)}>
      <TabList aria-label="Production stages" className="flex gap-1 border-b border-neutral-200">
        {PODCAST_TABS.map((def, i) => (
          <Tab
            key={def.tab}
            disabled={states[i] === 'locked'}
            title={states[i] === 'locked' ? def.lockedReason : undefined}
            className="-mb-px inline-flex items-center gap-2 rounded-t-md border-b-2 border-transparent px-4 py-2 text-sm font-medium text-neutral-600
              hover:text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500
              data-[selected]:border-brand-700 data-[selected]:text-brand-800
              data-[disabled]:cursor-not-allowed data-[disabled]:text-neutral-400 data-[disabled]:hover:text-neutral-400"
          >
            <StateIcon state={states[i]} />
            {LABEL[def.tab]}
            <span className="sr-only">
              {`, ${STATE_TEXT[states[i]]}`}{states[i] === 'locked' ? `: ${def.lockedReason}` : ''}
            </span>
          </Tab>
        ))}
      </TabList>
      <TabPanels className="pt-4">
        {PODCAST_TABS.map(def => (
          <TabPanel key={def.tab} className="focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded-md">
            {panels[def.tab]}
          </TabPanel>
        ))}
      </TabPanels>
    </TabGroup>
  )
}

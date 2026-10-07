import type { Podcast, PodcastStage } from '@shared/types'

export type PodcastTab = 'stories' | 'script' | 'audio'

/**
 * - `done`: the tab's output exists (and needs nothing from a person)
 * - `running`: a run is working toward it
 * - `review`: an interactive episode waits for a person's review of it
 * - `error`: the last run toward it failed or is blocked
 * - `next`: it is the next step, at rest
 * - `locked`: the step before it has not happened yet
 */
export type TabState = 'done' | 'running' | 'review' | 'error' | 'next' | 'locked'

interface TabDef {
  tab: PodcastTab
  /** The stage the episode must have reached for the tab to open. */
  from: PodcastStage
  /** The stage the tab's work produces. */
  produces: PodcastStage
  /** Why the tab is not open yet. */
  lockedReason: string
}

export const PODCAST_TABS: readonly TabDef[] = [
  { tab: 'stories', from: 'created', produces: 'selected', lockedReason: '' },
  { tab: 'script', from: 'selected', produces: 'scripted', lockedReason: 'The script is written once the stories are chosen.' },
  { tab: 'audio', from: 'scripted', produces: 'ready', lockedReason: 'The audio is made once the script is approved.' },
]

const ORDER: PodcastStage[] = ['created', 'selected', 'scripted', 'voiced', 'ready']

type TabFields = Pick<Podcast, 'stage' | 'inProgress' | 'awaitingReview' | 'blockedAt' | 'lastError'>

/** Each tab's progress state, from where the episode is and whether a run, a review or a failure holds it. */
export function tabState(podcast: TabFields, def: TabDef): TabState {
  const at = ORDER.indexOf(podcast.stage)
  if (at < ORDER.indexOf(def.from)) return 'locked'
  if (at >= ORDER.indexOf(def.produces)) {
    return podcast.awaitingReview && podcast.stage === def.produces ? 'review' : 'done'
  }
  if (podcast.inProgress) return 'running'
  if (podcast.blockedAt || podcast.lastError) return 'error'
  return 'next'
}

const ATTENTION: TabState[] = ['review', 'running', 'error']

/** The tab of the current stage: the first that needs attention, else the next step, else the last. */
export function defaultTab(podcast: TabFields): PodcastTab {
  const states = PODCAST_TABS.map(def => tabState(podcast, def))
  const attention = states.findIndex(s => ATTENTION.includes(s))
  if (attention >= 0) return PODCAST_TABS[attention].tab
  const next = states.indexOf('next')
  return PODCAST_TABS[next >= 0 ? next : PODCAST_TABS.length - 1].tab
}

/** The tab named in the URL when it exists and is open, otherwise the tab of the current stage. */
export function resolveTab(param: string | null, podcast: TabFields): PodcastTab {
  const def = PODCAST_TABS.find(d => d.tab === param)
  if (def && tabState(podcast, def) !== 'locked') return def.tab
  return defaultTab(podcast)
}

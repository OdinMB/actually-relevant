import { useCallback } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import type { Story } from '@shared/types'
import { availableTabs, resolveStoryTab, type StoryTab } from '../components/admin/storyTabs'
import { useResearchRuns, useResearchUsage } from './useResearch'
import { contextShown, useStoryContextAdmin } from './useStoryContextAdmin'

/**
 * The story page's tabs: those the story has (Research unless the backend has no research, Context
 * once its section shows, Social when the story is published and the page drafts posts), the open
 * one from the address (`?tab=`), and which sections could not be loaded. Choosing a tab replaces
 * the address's entry and keeps its location state, so reload and Back reopen the tab and the back
 * link still returns to where the story was opened from (`storyReturn.ts`).
 */
export function useStoryTabs(story: Pick<Story, 'id' | 'status'>, drafts: boolean) {
  const [params, setParams] = useSearchParams()
  const { state } = useLocation()
  const usage = useResearchUsage()
  const runs = useResearchRuns(story.id, usage.data != null)
  const context = useStoryContextAdmin(story.id)

  const tabs = availableTabs({
    // Shown while it loads, since a backend without research (null) is the rare case
    research: usage.data !== null,
    context: contextShown(context),
    social: story.status === 'published' && drafts,
  })
  const tab = resolveStoryTab(params.get('tab'), tabs)

  const setTab = useCallback(
    (next: StoryTab) =>
      setParams(
        prev => {
          const updated = new URLSearchParams(prev)
          updated.set('tab', next)
          return updated
        },
        { replace: true, state },
      ),
    [setParams, state],
  )

  return { tabs, tab, setTab, failed: { research: usage.isError || runs.isError, context: context.isError } }
}

import { useState, useEffect, useCallback } from 'react'
import { Helmet } from 'react-helmet-async'
import { useQuery } from '@tanstack/react-query'
import { publicApi } from '../lib/api'
import { getSavedSlugs, subscribeSaved } from '../lib/preferences'
import { SEO, CommonOgTags } from '../lib/seo'
import StoryCard from '../components/StoryCard'
import type { PublicStory } from '@shared/types'

const META = {
  title: 'Saved Stories - Actually Relevant',
  description: 'Your saved stories on Actually Relevant.',
  url: `${SEO.siteUrl}/saved`,
}

export default function SavedPage() {
  const [savedSlugs, setSavedSlugs] = useState<string[]>([])

  useEffect(() => {
    setSavedSlugs(getSavedSlugs())
  }, [])

  // Listen for storage changes from other tabs or bookmark toggles
  const refreshSaved = useCallback(() => {
    setSavedSlugs(getSavedSlugs())
  }, [])

  useEffect(() => subscribeSaved(refreshSaved), [refreshSaved])

  // Fetch all saved stories (up to 100)
  const { data: stories, isLoading } = useQuery({
    queryKey: ['saved-stories', savedSlugs],
    queryFn: async () => {
      if (savedSlugs.length === 0) return []
      // Fetch each story individually (they're cached by the browser)
      const results = await Promise.allSettled(savedSlugs.map(slug => publicApi.stories.get(slug)))
      return results
        .filter((r): r is PromiseFulfilledResult<PublicStory> => r.status === 'fulfilled')
        .map(r => r.value)
        .reverse() // most recently saved first
    },
    enabled: savedSlugs.length > 0,
  })

  return (
    <>
      <Helmet>
        <title>{META.title}</title>
        <meta name="description" content={META.description} />
        <meta property="og:title" content={META.title} />
        <meta property="og:description" content={META.description} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={META.url} />
        {CommonOgTags({})}
      </Helmet>

      <div className="page-section py-12">
        <h1 className="page-title mb-2">Saved Stories</h1>

        {savedSlugs.length === 0 && (
          <div className="text-center py-12">
            <p className="text-neutral-500 mb-4">You haven't saved any stories yet.</p>
            <p className="text-sm text-neutral-500 mb-6">Click the bookmark icon on any story to save it here.</p>
          </div>
        )}

        {isLoading && savedSlugs.length > 0 && <div className="text-center py-12 text-neutral-500">Loading saved stories...</div>}

        {stories && stories.length > 0 && (
          <div className="space-y-4">
            {stories.map(story => (
              <StoryCard key={story.id} story={story} variant="compact" />
            ))}
          </div>
        )}

        {savedSlugs.length > 0 && <p className="text-xs text-neutral-500 mt-8 text-center">Saved stories are stored in this browser only.</p>}
      </div>
    </>
  )
}

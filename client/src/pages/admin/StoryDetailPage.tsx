import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import { ArrowLeftIcon } from '@heroicons/react/24/outline'
import { useStory } from '../../hooks/useStories'
import { useIssues } from '../../hooks/useIssues'
import { ApiError } from '../../lib/admin-api'
import { STATUS_VARIANTS, formatStatus } from '../../lib/constants'
import { Badge } from '../../components/ui/Badge'
import { PageHeader } from '../../components/ui/PageHeader'
import { LoadingSpinner } from '../../components/ui/LoadingSpinner'
import { ErrorState } from '../../components/ui/ErrorState'
import { StoryEditForm } from '../../components/admin/StoryEditForm'
import { backLink } from '../../components/admin/storyReturn'
import { useSocialDrafts } from '../../components/admin/social/useSocialDrafts'

const BACK_LINK =
  'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500'
const SITE_LINK =
  'inline-flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2'

/**
 * A story's admin page, `/admin/stories/:id`: the title with the story's status and rating, then the
 * story editor (`StoryEditForm`), its sections as tabs and its actions in the bar under them. Its
 * back link, Cancel and Save return to the page the story was opened from as that page was
 * (`storyReturn.ts`), or to the stories list when the page was opened from a bookmark.
 */
export default function StoryDetailPage() {
  const { id = '' } = useParams<{ id: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const back = backLink(location.state)
  const { data: story, isLoading, error, refetch } = useStory(id)
  const issuesQuery = useIssues()
  const social = useSocialDrafts()
  const notFound = error instanceof ApiError && error.status === 404
  const title = story ? story.title || story.sourceTitle : null

  return (
    // Fills the view, so the form's action bar sits at its bottom under a short tab too
    <div className="flex min-h-full flex-col">
      <Helmet>
        <title>{title ? `${title} — Admin — Actually Relevant` : 'Story — Admin — Actually Relevant'}</title>
      </Helmet>

      <div className="mb-4">
        <Link to={back.to} state={back.state} className={BACK_LINK}>
          <ArrowLeftIcon className="h-4 w-4" aria-hidden="true" /> {back.label}
        </Link>
      </div>

      {isLoading && (
        <div className="flex justify-center py-12">
          <h1 className="sr-only">Loading story</h1>
          <LoadingSpinner />
        </div>
      )}
      {notFound && <PageHeader title="Story not found" description="No story has this address. It may have been deleted." />}
      {error && !notFound && (
        <>
          <h1 className="sr-only">Story</h1>
          <ErrorState message="Failed to load story" onRetry={() => refetch()} />
        </>
      )}

      {story && title !== null && (
        <>
          <PageHeader
            title={title}
            // The bar's actions follow the status, which shows on every tab here
            description={
              <span className="inline-flex flex-wrap items-center gap-2">
                <Badge variant={STATUS_VARIANTS[story.status]}>{formatStatus(story.status)}</Badge>
                {story.relevance != null && <span>Rating {story.relevance}</span>}
              </span>
            }
            actions={
              story.status === 'published' &&
              story.slug && (
                <a href={`/stories/${story.slug}`} target="_blank" rel="noopener noreferrer" className={SITE_LINK}>
                  View on site <span aria-hidden="true">↗</span>
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              )
            }
          />
          <StoryEditForm
            story={story}
            issues={issuesQuery.data || []}
            onDone={() => navigate(back.to, { state: back.state })}
            onBlueskyGenerate={storyId => social.generate('bluesky', storyId)}
            onMastodonGenerate={storyId => social.generate('mastodon', storyId)}
          />
          {/* The draft panels are dialogs of their own, beside the form rather than in it */}
          {social.panels}
        </>
      )}
    </div>
  )
}

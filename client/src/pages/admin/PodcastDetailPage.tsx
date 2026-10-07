import { Link, useParams } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import { ArrowLeftIcon } from '@heroicons/react/24/outline'
import { usePodcast } from '../../hooks/usePodcasts'
import { LoadingSpinner } from '../../components/ui/LoadingSpinner'
import { ErrorState } from '../../components/ui/ErrorState'
import { PodcastDetail } from '../../components/admin/PodcastDetail'

export default function PodcastDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: podcast, isLoading, error, refetch } = usePodcast(id || '')

  return (
    <>
      <Helmet>
        <title>{podcast?.title || 'Podcast'} — Admin — Actually Relevant</title>
      </Helmet>

      <div className="flex min-h-full flex-col">
        <div className="mb-4">
          {/* A link, so the page's unsaved-changes guard holds it like any other in-app link */}
          <Link
            to="/admin/podcasts"
            className="inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <ArrowLeftIcon className="h-4 w-4" aria-hidden="true" /> Back to Podcasts
          </Link>
        </div>

        {isLoading && <div className="flex justify-center py-12"><LoadingSpinner /></div>}
        {error && <ErrorState message="Failed to load podcast" onRetry={refetch} />}

        {podcast && <PodcastDetail podcast={podcast} />}
      </div>
    </>
  )
}

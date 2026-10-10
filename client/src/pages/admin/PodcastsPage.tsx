import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import { usePodcasts, usePodcastWeekSlot, useStartWeeklyPodcast, useCreateStandalonePodcast, useDeletePodcast } from '../../hooks/usePodcasts'
import { PodcastWeekSlotNotice } from '../../components/admin/PodcastWeekSlotNotice'
import { PageHeader } from '../../components/ui/PageHeader'
import { Button } from '../../components/ui/Button'
import { LoadingSpinner } from '../../components/ui/LoadingSpinner'
import { ErrorState } from '../../components/ui/ErrorState'
import { EmptyState } from '../../components/ui/EmptyState'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { PodcastTable } from '../../components/admin/PodcastTable'
import { useToast } from '../../components/ui/Toast'

export default function PodcastsPage() {
  const [statusFilter, setStatusFilter] = useState<string>('')
  const podcastsQuery = usePodcasts(statusFilter ? { status: statusFilter } : undefined)
  const weekSlot = usePodcastWeekSlot()
  const claimedEpisode = weekSlot.data?.episode ?? null
  const startWeekly = useStartWeeklyPodcast()
  const createStandalone = useCreateStandalonePodcast()
  const deletePodcast = useDeletePodcast()
  const navigate = useNavigate()
  const { toast } = useToast()

  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [confirmClaim, setConfirmClaim] = useState(false)

  /**
   * A claimed slot's episode opens directly: the click claims nothing. Otherwise (free, or not
   * known yet) a confirm comes first, since the POST makes this week's episode, which Friday's
   * automatic run then finishes or skips instead of making its own.
   */
  const handleWeeklyClick = () => {
    if (claimedEpisode) navigate(`/admin/podcasts/${claimedEpisode.id}`)
    else setConfirmClaim(true)
  }

  /** Opens this week's episode (created on first use); it runs once a mode is chosen there. */
  const handleStartWeekly = async () => {
    setConfirmClaim(false)
    try {
      const pod = await startWeekly.mutateAsync()
      navigate(`/admin/podcasts/${pod.id}`)
    } catch {
      toast('error', "Failed to open this week's episode")
    }
  }

  /** Creates a standalone episode and opens it, where its stories are chosen. */
  const handleCreateStandalone = async () => {
    try {
      const pod = await createStandalone.mutateAsync()
      navigate(`/admin/podcasts/${pod.id}`)
    } catch {
      toast('error', 'Failed to create the episode')
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      await deletePodcast.mutateAsync(deleteId)
      toast('success', 'Podcast deleted')
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to delete')
    }
    setDeleteId(null)
  }

  const tabs = [
    { label: 'All', value: '' },
    { label: 'Draft', value: 'draft' },
    { label: 'Published', value: 'published' },
  ]

  return (
    <>
      <Helmet>
        <title>Podcasts — Admin — Actually Relevant</title>
      </Helmet>

      <PageHeader
        title="Podcasts"
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={handleCreateStandalone} loading={createStandalone.isPending}>New podcast</Button>
            <Button onClick={handleWeeklyClick} loading={startWeekly.isPending}>
              {claimedEpisode ? "Open this week's episode" : "Start this week's episode"}
            </Button>
          </div>
        )}
      />

      <PodcastWeekSlotNotice slot={weekSlot.data} failed={weekSlot.isError} />

      <div className="flex gap-1 mb-4">
        {tabs.map(tab => (
          <button
            key={tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
              statusFilter === tab.value
                ? 'bg-brand-50 text-brand-700'
                : 'text-neutral-600 hover:bg-neutral-100'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {podcastsQuery.isLoading && <div className="flex justify-center py-12"><LoadingSpinner /></div>}
      {podcastsQuery.error && <ErrorState message="Failed to load podcasts" onRetry={() => podcastsQuery.refetch()} />}
      {podcastsQuery.data && podcastsQuery.data.data.length === 0 && <EmptyState title="No podcasts yet" description="Start this week's episode and choose whether to review each step or let it run, or make a new podcast from stories you pick." />}
      {podcastsQuery.data && podcastsQuery.data.data.length > 0 && (
        <PodcastTable
          podcasts={podcastsQuery.data.data}
          onView={id => navigate(`/admin/podcasts/${id}`)}
          onDelete={setDeleteId}
        />
      )}

      <ConfirmDialog
        open={confirmClaim}
        onClose={() => setConfirmClaim(false)}
        onConfirm={handleStartWeekly}
        title="Make this week's episode?"
        description="This becomes this week's episode. Friday's automatic run will then finish or skip it instead of making a new one. For a test or a one-off, use New podcast."
        confirmLabel="Start this week's episode"
      />

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete podcast?"
        description="This will permanently remove this podcast."
        variant="danger"
        confirmLabel="Delete"
        loading={deletePodcast.isPending}
      />
    </>
  )
}

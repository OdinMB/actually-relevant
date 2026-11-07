import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import type { PodcastEdition } from '@shared/types'
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

/** The confirm before claiming a show's free slot. */
const CLAIM_DIALOG: Record<PodcastEdition, { title: string; description: string; confirmLabel: string }> = {
  full: {
    title: "Start this week's episode?",
    description:
      "This becomes this week's episode. Friday's automatic run will then finish or skip it instead of making a new one. For a test or a one-off, use “New podcast” instead.",
    confirmLabel: "Start this week's episode",
  },
  uplifting: {
    title: "Start this week's Actually Uplifting episode?",
    description: "This becomes this week's Actually Uplifting episode. Friday's automatic run will then finish or skip it instead of making a new one.",
    confirmLabel: "Start this week's Actually Uplifting episode",
  },
}

export default function PodcastsPage() {
  const [statusFilter, setStatusFilter] = useState<string>('')
  const podcastsQuery = usePodcasts(statusFilter ? { status: statusFilter } : undefined)
  const slots = { full: usePodcastWeekSlot('full'), uplifting: usePodcastWeekSlot('uplifting') }
  const weekSlot = slots.full
  const claimedEpisode = weekSlot.data?.episode ?? null
  const upliftingSlot = slots.uplifting.data
  const startWeekly = useStartWeeklyPodcast()
  const createStandalone = useCreateStandalonePodcast()
  const deletePodcast = useDeletePodcast()
  const navigate = useNavigate()
  const { toast } = useToast()

  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [confirmClaim, setConfirmClaim] = useState<PodcastEdition | null>(null)

  /**
   * A claimed slot's episode opens directly: the click claims nothing. Otherwise (free, or the
   * slot could not be read) a confirm comes first, since the POST makes this week's episode, which
   * Friday's automatic run then finishes or skips instead of making its own. While the slot is
   * still loading the button shows as loading, so the dialog never misstates a claimed week.
   */
  const handleWeeklyClick = (edition: PodcastEdition) => {
    const claimed = slots[edition].data?.episode
    if (claimed) navigate(`/admin/podcasts/${claimed.id}`)
    else setConfirmClaim(edition)
  }

  /** Opens the show's episode this week (created on first use); it runs once a mode is chosen there. */
  const handleStartWeekly = async () => {
    const edition = confirmClaim
    setConfirmClaim(null)
    if (!edition) return
    try {
      const pod = await startWeekly.mutateAsync(edition)
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
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={handleCreateStandalone} loading={createStandalone.isPending}>
              New podcast
            </Button>
            <Button onClick={() => handleWeeklyClick('full')} loading={startWeekly.isPending || weekSlot.isPending}>
              {claimedEpisode ? "Open this week's episode" : "Start this week's episode"}
            </Button>
          </div>
        }
      />

      <PodcastWeekSlotNotice slot={weekSlot.data} failed={weekSlot.isError} />
      {/* Actually Uplifting: its own slot; no button while it is switched off (the notice says why) */}
      <PodcastWeekSlotNotice
        edition="uplifting"
        slot={upliftingSlot}
        failed={slots.uplifting.isError}
        action={
          upliftingSlot && (
            <Button size="sm" variant="secondary" onClick={() => handleWeeklyClick('uplifting')} loading={startWeekly.isPending}>
              {upliftingSlot.episode ? "Open this week's Actually Uplifting episode" : "Start this week's Actually Uplifting episode"}
            </Button>
          )
        }
      />

      <div className="flex gap-1 mb-4">
        {tabs.map(tab => (
          <button
            key={tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
              statusFilter === tab.value ? 'bg-brand-50 text-brand-700' : 'text-neutral-600 hover:bg-neutral-100'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {podcastsQuery.isLoading && (
        <div className="flex justify-center py-12">
          <LoadingSpinner />
        </div>
      )}
      {podcastsQuery.error && <ErrorState message="Failed to load podcasts" onRetry={() => podcastsQuery.refetch()} />}
      {podcastsQuery.data && podcastsQuery.data.data.length === 0 && (
        <EmptyState
          title="No podcasts yet"
          description="Start this week's episode and choose whether to review each step or let it run, or make a new podcast from stories you pick."
        />
      )}
      {podcastsQuery.data && podcastsQuery.data.data.length > 0 && (
        <PodcastTable podcasts={podcastsQuery.data.data} onView={id => navigate(`/admin/podcasts/${id}`)} onDelete={setDeleteId} />
      )}

      <ConfirmDialog
        open={confirmClaim !== null}
        onClose={() => setConfirmClaim(null)}
        onConfirm={handleStartWeekly}
        {...CLAIM_DIALOG[confirmClaim ?? 'full']}
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

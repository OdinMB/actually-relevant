import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Helmet } from 'react-helmet-async'
import type { StoryStatus, StoryFilters, StorySort } from '@shared/types'
import { useStories, useBulkUpdateStatus, useDeleteStory, useUpdateStoryStatus, invalidateStoryQueries } from '../../hooks/useStories'
import { useFeeds } from '../../hooks/useFeeds'
import { useIssues } from '../../hooks/useIssues'
import { useBackgroundTasks } from '../../hooks/useBackgroundTasks'
import { useBulkApplyResearch, useBulkResearch, useResearchUsage } from '../../hooks/useResearch'
import { adminApi } from '../../lib/admin-api'
import { PageHeader } from '../../components/ui/PageHeader'
import { Button } from '../../components/ui/Button'
import { LoadingSpinner } from '../../components/ui/LoadingSpinner'
import { ErrorState } from '../../components/ui/ErrorState'
import { EmptyState } from '../../components/ui/EmptyState'
import { Pagination } from '../../components/ui/Pagination'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { StoryFiltersBar } from '../../components/admin/StoryFiltersBar'
import { StoryTable } from '../../components/admin/StoryTable'
import { BulkActionsBar, type BulkAction } from '../../components/admin/BulkActionsBar'
import { bulkApplyRefusal, bulkResearchRefusal } from '../../components/admin/bulkResearch'
import { storyBulkActions, type ConfirmAction } from '../../components/admin/storyBulkActions'
import { StoryDetail } from '../../components/admin/StoryDetail'
import { CrawlUrlForm } from '../../components/admin/CrawlUrlForm'
import { CreateClusterDialog } from '../../components/admin/CreateClusterDialog'
import { BlueskyDraftPanel } from '../../components/admin/BlueskyDraftPanel'
import type { BlueskyDraft } from '../../components/admin/BlueskyDraftPanel'
import { MastodonDraftPanel } from '../../components/admin/MastodonDraftPanel'
import type { MastodonDraft } from '../../components/admin/MastodonDraftPanel'
import { useToast } from '../../components/ui/Toast'

const DEFAULT_PAGE_SIZE = 25
const ACCESS_TIER_FILTERS = ['locked', 'metered'] as const

function useFiltersFromParams(): StoryFilters {
  const [searchParams] = useSearchParams()
  return {
    status: (searchParams.get('status') as StoryStatus) || undefined,
    issueId: searchParams.get('issueId') || undefined,
    feedId: searchParams.get('feedId') || undefined,
    emotionTag: (searchParams.get('emotionTag') as StoryFilters['emotionTag']) || undefined,
    rating: searchParams.get('rating') || undefined,
    accessTier: ACCESS_TIER_FILTERS.find(t => t === searchParams.get('accessTier')),
    sort: (searchParams.get('sort') as StorySort) || 'date_desc',
    page: Number(searchParams.get('page')) || 1,
    pageSize: Number(searchParams.get('pageSize')) || DEFAULT_PAGE_SIZE,
  }
}

export default function StoriesPage() {
  const [searchParams, setSearchParams] = useSearchParams()

  // Default to "published" filter on first visit (no status param in URL)
  const didDefaultRef = useRef(false)
  useEffect(() => {
    if (!didDefaultRef.current && !searchParams.has('status')) {
      didDefaultRef.current = true
      const next = new URLSearchParams(searchParams)
      next.set('status', 'published')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, setSearchParams])

  const filters = useFiltersFromParams()
  const queryClient = useQueryClient()
  const storiesQuery = useStories(filters)
  const feedsQuery = useFeeds()
  const issuesQuery = useIssues()
  const { toast } = useToast()
  const { launchTask, launchPolledTask, processingIds } = useBackgroundTasks()
  const researchUsage = useResearchUsage()
  const startBulkResearch = useBulkResearch()
  const applyBulkResearch = useBulkApplyResearch()

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [detailId, setDetailId] = useState<string | null>(null)
  const [crawlOpen, setCrawlOpen] = useState(false)
  const [clusterDialogOpen, setClusterDialogOpen] = useState(false)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)
  const [blueskyDraft, setBlueskyDraft] = useState<BlueskyDraft | null>(null)
  const [blueskyPanelOpen, setBlueskyPanelOpen] = useState(false)
  const [blueskyPublishing, setBlueskyPublishing] = useState(false)
  const [mastodonDraft, setMastodonDraft] = useState<MastodonDraft | null>(null)
  const [mastodonPanelOpen, setMastodonPanelOpen] = useState(false)
  const [mastodonPublishing, setMastodonPublishing] = useState(false)

  const bulkUpdate = useBulkUpdateStatus()
  const deleteStory = useDeleteStory()
  const updateStatus = useUpdateStoryStatus()

  const invalidateStories = useCallback(() => invalidateStoryQueries(queryClient), [queryClient])

  const stories = useMemo(() => storiesQuery.data?.data || [], [storiesQuery.data])

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleSelectAll = useCallback(() => {
    setSelectedIds(prev => {
      const allOnPageSelected = stories.length > 0 && stories.every(s => prev.has(s.id))
      return allOnPageSelected ? new Set() : new Set(stories.map(s => s.id))
    })
  }, [stories])

  const setPage = (page: number) => {
    const next = new URLSearchParams(searchParams)
    next.set('page', String(page))
    setSearchParams(next)
    setSelectedIds(new Set())
  }

  const setPageSize = (size: number) => {
    const next = new URLSearchParams(searchParams)
    next.set('pageSize', String(size))
    next.set('page', '1')
    setSearchParams(next)
    setSelectedIds(new Set())
  }

  const bulkActions = storyBulkActions({
    confirm: setConfirmAction,
    clearSelection: () => setSelectedIds(new Set()),
    toast,
    launchPolledTask,
    onTaskComplete: invalidateStories,
    researchUsage: researchUsage.data,
    startResearch: startBulkResearch,
    applyResearch: applyBulkResearch,
    titleOf: id => {
      const story = stories.find(s => s.id === id)
      return story ? (story.title ?? story.sourceTitle) : id
    },
    drafts: {
      bluesky: {
        open: () => {
          setBlueskyPanelOpen(true)
          setBlueskyDraft(null)
        },
        show: draft => setBlueskyDraft(draft as BlueskyDraft),
        close: () => setBlueskyPanelOpen(false),
      },
      mastodon: {
        open: () => {
          setMastodonPanelOpen(true)
          setMastodonDraft(null)
        },
        show: draft => setMastodonDraft(draft as MastodonDraft),
        close: () => setMastodonPanelOpen(false),
      },
    },
    openClusterDialog: () => setClusterDialogOpen(true),
    setStatus: async (ids, status) => {
      await bulkUpdate.mutateAsync({ ids, status })
    },
  })

  const handleBulkAction = (action: BulkAction) => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    bulkActions[action](ids)
  }

  const handleSingleStatusChange = (id: string, status: StoryStatus) => {
    updateStatus.mutate(
      { id, status },
      {
        onSuccess: () => toast('success', 'Status updated'),
        onError: () => toast('error', 'Failed to update status'),
      },
    )
  }

  const handlePreassess = (id: string) => {
    launchTask({
      id: `preassess-${id}-${Date.now()}`,
      label: 'Pre-assessing story',
      executor: async () => {
        await adminApi.stories.preassess([id])
        return { succeeded: 1, failed: 0 }
      },
      onComplete: invalidateStories,
      storyIds: [id],
    })
  }

  const handleAssess = (id: string) => {
    launchTask({
      id: `assess-${id}-${Date.now()}`,
      label: 'Assessing story',
      executor: async () => {
        await adminApi.stories.assess(id)
        return { succeeded: 1, failed: 0 }
      },
      onComplete: invalidateStories,
      storyIds: [id],
    })
  }

  const handlePublish = (id: string) => {
    launchTask({
      id: `publish-${id}-${Date.now()}`,
      label: 'Publishing story',
      executor: async () => {
        await adminApi.stories.publish(id)
        return { succeeded: 1, failed: 0 }
      },
      onComplete: invalidateStories,
      storyIds: [id],
    })
  }

  const handleDelete = (id: string) => {
    setConfirmAction({
      title: 'Delete story?',
      description: 'This action cannot be undone.',
      action: async () => {
        await deleteStory.mutateAsync(id)
        toast('success', 'Story deleted')
        setDetailId(null)
      },
    })
  }

  const handleBlueskyPublish = async (postId: string) => {
    setBlueskyPublishing(true)
    try {
      await adminApi.bluesky.publishPost(postId)
      toast('success', 'Posted to Bluesky')
      setBlueskyPanelOpen(false)
      setBlueskyDraft(null)
      setSelectedIds(new Set())
      queryClient.invalidateQueries({ queryKey: ['stories'] })
      queryClient.invalidateQueries({ queryKey: ['story'] })
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to publish')
    } finally {
      setBlueskyPublishing(false)
    }
  }

  const handleBlueskyUpdate = async (postId: string, text: string) => {
    try {
      await adminApi.bluesky.updateDraft(postId, text)
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to save draft')
      throw err
    }
  }

  const handleBlueskyDelete = async (postId: string) => {
    try {
      await adminApi.bluesky.deletePost(postId)
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to delete draft')
      throw err
    }
  }

  const handleMastodonPublish = async (postId: string) => {
    setMastodonPublishing(true)
    try {
      await adminApi.mastodon.publishPost(postId)
      toast('success', 'Posted to Mastodon')
      setMastodonPanelOpen(false)
      setMastodonDraft(null)
      setSelectedIds(new Set())
      queryClient.invalidateQueries({ queryKey: ['stories'] })
      queryClient.invalidateQueries({ queryKey: ['story'] })
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to publish')
    } finally {
      setMastodonPublishing(false)
    }
  }

  const handleMastodonUpdate = async (postId: string, text: string) => {
    try {
      await adminApi.mastodon.updateDraft(postId, text)
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to save draft')
      throw err
    }
  }

  const handleMastodonDelete = async (postId: string) => {
    try {
      await adminApi.mastodon.deletePost(postId)
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to delete draft')
      throw err
    }
  }

  const confirmLoading = bulkUpdate.isPending || deleteStory.isPending

  return (
    <>
      <Helmet>
        <title>Stories — Admin — Actually Relevant</title>
      </Helmet>

      <PageHeader
        title="Stories"
        description={storiesQuery.data ? `${storiesQuery.data.total} stories` : undefined}
        actions={
          <Button variant="secondary" onClick={() => setCrawlOpen(true)}>
            Crawl URL
          </Button>
        }
      />

      <StoryFiltersBar issues={issuesQuery.data || []} feeds={feedsQuery.data || []} />

      {storiesQuery.isLoading && (
        <div className="flex justify-center py-12">
          <LoadingSpinner />
        </div>
      )}

      {storiesQuery.error && <ErrorState message="Failed to load stories" onRetry={() => storiesQuery.refetch()} />}

      {storiesQuery.data && stories.length === 0 && <EmptyState title="No stories found" description="Try adjusting your filters." />}

      {storiesQuery.data && stories.length > 0 && (
        <>
          <StoryTable
            stories={stories}
            selectedIds={selectedIds}
            processingIds={processingIds}
            onToggleSelect={toggleSelect}
            onToggleSelectAll={toggleSelectAll}
            allSelected={stories.length > 0 && stories.every(s => selectedIds.has(s.id))}
            onView={setDetailId}
            onStatusChange={handleSingleStatusChange}
            onDelete={handleDelete}
            onPreassess={handlePreassess}
            onAssess={handleAssess}
            onPublish={handlePublish}
          />

          <Pagination
            page={storiesQuery.data.page}
            totalPages={storiesQuery.data.totalPages}
            onPageChange={setPage}
            pageSize={filters.pageSize}
            onPageSizeChange={setPageSize}
          />
        </>
      )}

      <BulkActionsBar
        count={selectedIds.size}
        onAction={handleBulkAction}
        loading={confirmLoading}
        researchRefusal={bulkResearchRefusal(selectedIds.size, researchUsage.data, researchUsage.isError)}
        applyResearchRefusal={bulkApplyRefusal(selectedIds.size, researchUsage.data, researchUsage.isError)}
        allHaveRelevance={selectedIds.size > 0 && stories.filter(s => selectedIds.has(s.id)).every(s => s.relevance != null)}
        allPublished={selectedIds.size > 0 && stories.filter(s => selectedIds.has(s.id)).every(s => s.status === 'published')}
        singleHasBlueskyPost={selectedIds.size === 1 && stories.some(s => selectedIds.has(s.id) && (s._count?.blueskyPosts ?? 0) > 0)}
        singleHasMastodonPost={selectedIds.size === 1 && stories.some(s => selectedIds.has(s.id) && (s._count?.mastodonPosts ?? 0) > 0)}
      />

      <StoryDetail
        storyId={detailId}
        issues={issuesQuery.data || []}
        onClose={() => setDetailId(null)}
        onBlueskyGenerate={storyId => {
          setBlueskyPanelOpen(true)
          setBlueskyDraft(null)
          adminApi.bluesky
            .generateDraft(storyId)
            .then(draft => setBlueskyDraft(draft as BlueskyDraft))
            .catch(err => {
              toast('error', err instanceof Error ? err.message : 'Failed to generate draft')
              setBlueskyPanelOpen(false)
            })
        }}
        onMastodonGenerate={storyId => {
          setMastodonPanelOpen(true)
          setMastodonDraft(null)
          adminApi.mastodon
            .generateDraft(storyId)
            .then(draft => setMastodonDraft(draft as MastodonDraft))
            .catch(err => {
              toast('error', err instanceof Error ? err.message : 'Failed to generate draft')
              setMastodonPanelOpen(false)
            })
        }}
      />

      <CrawlUrlForm open={crawlOpen} onClose={() => setCrawlOpen(false)} />

      <CreateClusterDialog
        open={clusterDialogOpen}
        onClose={() => setClusterDialogOpen(false)}
        stories={stories.filter(s => selectedIds.has(s.id))}
        onSuccess={() => setSelectedIds(new Set())}
      />

      <BlueskyDraftPanel
        open={blueskyPanelOpen}
        onClose={() => {
          setBlueskyPanelOpen(false)
          setBlueskyDraft(null)
        }}
        draft={blueskyDraft}
        onPublish={handleBlueskyPublish}
        onUpdate={handleBlueskyUpdate}
        onDelete={handleBlueskyDelete}
        publishing={blueskyPublishing}
      />

      <MastodonDraftPanel
        open={mastodonPanelOpen}
        onClose={() => {
          setMastodonPanelOpen(false)
          setMastodonDraft(null)
        }}
        draft={mastodonDraft}
        onPublish={handleMastodonPublish}
        onUpdate={handleMastodonUpdate}
        onDelete={handleMastodonDelete}
        publishing={mastodonPublishing}
      />

      <ConfirmDialog
        open={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        onConfirm={async () => {
          if (confirmAction) {
            try {
              await confirmAction.action()
            } catch (err) {
              toast('error', err instanceof Error ? err.message : 'Operation failed')
            }
          }
          setConfirmAction(null)
        }}
        title={confirmAction?.title || ''}
        description={confirmAction?.description}
        loading={confirmLoading}
      />
    </>
  )
}

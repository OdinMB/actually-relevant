import { useState, useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Helmet } from 'react-helmet-async'
import { TrashIcon, ArrowTopRightOnSquareIcon, ArrowPathIcon } from '@heroicons/react/24/outline'
import { PageHeader } from '../../ui/PageHeader'
import { Button } from '../../ui/Button'
import { LoadingSpinner } from '../../ui/LoadingSpinner'
import { ErrorState } from '../../ui/ErrorState'
import { EmptyState } from '../../ui/EmptyState'
import { ActionIconButton } from '../../ui/ActionIconButton'
import { useToast } from '../../ui/Toast'
import { formatRelativeTime } from '../../../lib/constants'

/** A draft or failed post that exists only in our database (same shape for every channel). */
export interface SocialDbOnlyPost {
  id: string
  postText: string
  status: string
  error: string | null
  createdAt: string
  storyTitle: string | null
  issueName: string | null
}

/** The fields every channel's feed item carries. */
export interface SocialFeedItemBase {
  text: string
  trackedPostId: string | null
  storyTitle: string | null
  issueName: string | null
}

/** One page of a channel's feed, with the channel's own pagination token as `next`. */
export interface SocialFeedPage<TItem> {
  feed: TItem[]
  next?: string
  dbOnlyPosts: SocialDbOnlyPost[]
}

/** What differs between channels: API calls, item fields and wording. */
export interface SocialChannel<TItem extends SocialFeedItemBase> {
  /** Display name, e.g. "Bluesky". */
  name: string
  /** React Query key for the first feed page. */
  feedQueryKey: string
  /** Loads the first page (`next` undefined) or the page after `next`. */
  getFeed: (next?: string) => Promise<SocialFeedPage<TItem>>
  deletePost: (postId: string) => Promise<unknown>
  refreshMetrics: () => Promise<unknown>
  itemKey: (item: TItem) => string
  postedAt: (item: TItem) => string
  /** Compact engagement summary for the table, e.g. "3L 1R 0C 0Q". */
  engagement: (item: TItem) => string
  /** The count averaged in the stats bar, and its label. */
  averaged: { label: string; count: (item: TItem) => number }
  /** Whether the item is a share of someone else's post, and what the channel calls that. */
  share: { label: string; is: (item: TItem) => boolean }
  /** The post's public URL, if it has one. */
  webUrl: (item: TItem) => string | null
  /** Hover color class for the "View on …" link. */
  linkHoverClass: string
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-amber-100 text-amber-800',
  published: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
}

type FeedFilter = 'all' | 'tracked' | 'untracked' | 'draft' | 'failed'

/** Admin page for one social channel: its live feed, our tracked posts, drafts and failures. */
export function SocialChannelPage<TItem extends SocialFeedItemBase>({ channel }: { channel: SocialChannel<TItem> }) {
  const [filter, setFilter] = useState<FeedFilter>('all')
  const [refreshing, setRefreshing] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [feedItems, setFeedItems] = useState<TItem[]>([])
  const [dbOnlyPosts, setDbOnlyPosts] = useState<SocialDbOnlyPost[]>([])
  const [next, setNext] = useState<string | undefined>(undefined)
  const [loadingMore, setLoadingMore] = useState(false)
  const queryClient = useQueryClient()
  const { toast } = useToast()

  // Initial feed load
  const feedQuery = useQuery({
    queryKey: [channel.feedQueryKey],
    queryFn: async () => {
      const result = await channel.getFeed()
      setFeedItems(result.feed)
      setDbOnlyPosts(result.dbOnlyPosts)
      setNext(result.next)
      return result
    },
  })

  const handleLoadMore = useCallback(async () => {
    if (!next || loadingMore) return
    setLoadingMore(true)
    try {
      const result = await channel.getFeed(next)
      setFeedItems(prev => [...prev, ...result.feed])
      setNext(result.next)
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to load more')
    } finally {
      setLoadingMore(false)
    }
  }, [channel, next, loadingMore, toast])

  const handleDelete = useCallback(
    async (postId: string) => {
      if (!confirm(`Delete this post? Published posts will also be removed from ${channel.name}.`)) return
      setDeletingId(postId)
      try {
        await channel.deletePost(postId)
        toast('success', 'Post deleted')
        queryClient.invalidateQueries({ queryKey: [channel.feedQueryKey] })
      } catch (err) {
        toast('error', err instanceof Error ? err.message : 'Failed to delete post')
      } finally {
        setDeletingId(null)
      }
    },
    [channel, queryClient, toast],
  )

  const handleRefreshMetrics = useCallback(async () => {
    setRefreshing(true)
    try {
      await channel.refreshMetrics()
      toast('success', 'Metrics updated')
      queryClient.invalidateQueries({ queryKey: [channel.feedQueryKey] })
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to refresh metrics')
    } finally {
      setRefreshing(false)
    }
  }, [channel, queryClient, toast])

  // Apply client-side filtering
  const filteredFeed = useMemo(
    () =>
      feedItems.filter(item => {
        if (filter === 'tracked') return item.trackedPostId !== null
        if (filter === 'untracked') return item.trackedPostId === null
        return true // 'all' — draft/failed shown separately
      }),
    [feedItems, filter],
  )

  const filteredDbOnly = useMemo(
    () =>
      filter === 'all' || filter === 'draft' || filter === 'failed'
        ? dbOnlyPosts.filter(p => {
            if (filter === 'draft') return p.status === 'draft'
            if (filter === 'failed') return p.status === 'failed'
            return true
          })
        : [],
    [dbOnlyPosts, filter],
  )

  // Hide the API feed table for draft/failed-only filters
  const showApiFeed = filter !== 'draft' && filter !== 'failed'

  // Stats from current feed data
  const { totalTracked, totalUntracked, average } = useMemo(
    () => ({
      totalTracked: feedItems.filter(i => i.trackedPostId).length,
      totalUntracked: feedItems.filter(i => !i.trackedPostId).length,
      average: feedItems.length > 0 ? Math.round(feedItems.reduce((sum, i) => sum + channel.averaged.count(i), 0) / feedItems.length) : 0,
    }),
    [feedItems, channel],
  )

  return (
    <>
      <Helmet>
        <title>{`${channel.name} — Admin — Actually Relevant`}</title>
      </Helmet>

      <PageHeader
        title={channel.name}
        description={feedItems.length > 0 ? `${feedItems.length} posts loaded` : undefined}
        actions={
          <Button variant="secondary" onClick={handleRefreshMetrics} loading={refreshing}>
            Refresh Metrics
          </Button>
        }
      />

      {/* Stats bar */}
      {feedQuery.data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <div className="rounded-md bg-white border border-neutral-200 p-3 text-center">
            <p className="text-2xl font-bold text-neutral-900">{feedItems.length}</p>
            <p className="text-xs text-neutral-500">Posts Loaded</p>
          </div>
          <div className="rounded-md bg-white border border-neutral-200 p-3 text-center">
            <p className="text-2xl font-bold text-neutral-900">{totalTracked}</p>
            <p className="text-xs text-neutral-500">Tracked</p>
          </div>
          <div className="rounded-md bg-white border border-neutral-200 p-3 text-center">
            <p className="text-2xl font-bold text-neutral-900">{totalUntracked}</p>
            <p className="text-xs text-neutral-500">Untracked</p>
          </div>
          <div className="rounded-md bg-white border border-neutral-200 p-3 text-center">
            <p className="text-2xl font-bold text-neutral-900">{average}</p>
            <p className="text-xs text-neutral-500">{channel.averaged.label}</p>
          </div>
        </div>
      )}

      {/* Filter buttons */}
      <div className="mb-4 flex gap-2">
        {(
          [
            { value: 'all', label: 'All' },
            { value: 'tracked', label: 'Tracked' },
            { value: 'untracked', label: 'Untracked' },
            { value: 'draft', label: 'Draft' },
            { value: 'failed', label: 'Failed' },
          ] as const
        ).map(({ value, label }) => (
          <button
            key={value}
            onClick={() => setFilter(value)}
            aria-pressed={filter === value}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
              filter === value ? 'bg-brand-100 text-brand-800 font-medium' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {feedQuery.isLoading && (
        <div className="flex justify-center py-12">
          <LoadingSpinner />
        </div>
      )}

      {feedQuery.error && <ErrorState message={`Failed to load ${channel.name} feed`} onRetry={() => feedQuery.refetch()} />}

      {/* Draft/Failed DB-only posts */}
      {filteredDbOnly.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-medium text-neutral-500 mb-2">{filter === 'draft' ? 'Drafts' : filter === 'failed' ? 'Failed' : 'Drafts & Failed'}</h3>
          <div className="overflow-x-auto bg-white rounded-lg border border-neutral-200 shadow-sm">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50">
                  <th scope="col" className="text-left px-3 py-2 font-medium text-neutral-500">
                    Post Text
                  </th>
                  <th scope="col" className="text-left px-3 py-2 font-medium text-neutral-500">
                    Story
                  </th>
                  <th scope="col" className="text-left px-3 py-2 font-medium text-neutral-500">
                    Status
                  </th>
                  <th scope="col" className="text-left px-3 py-2 font-medium text-neutral-500">
                    Created
                  </th>
                  <th scope="col" className="w-10 px-3 py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredDbOnly.map(post => (
                  <tr key={post.id} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
                    <td className="px-3 py-2 max-w-[300px]">
                      <p className="text-neutral-700 truncate">{post.postText}</p>
                      {post.error && (
                        <p className="text-xs text-red-600 truncate mt-0.5" title={post.error}>
                          {post.error}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2 max-w-[180px]">
                      {post.storyTitle ? (
                        <>
                          <p className="font-medium text-neutral-900 truncate">{post.storyTitle}</p>
                          {post.issueName && <p className="text-xs text-neutral-500">{post.issueName}</p>}
                        </>
                      ) : (
                        <span className="text-neutral-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[post.status] || 'bg-neutral-100 text-neutral-800'}`}
                      >
                        {post.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-neutral-500 whitespace-nowrap">{formatRelativeTime(post.createdAt)}</td>
                    <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                      <ActionIconButton
                        icon={TrashIcon}
                        label="Delete"
                        variant="danger"
                        onClick={() => handleDelete(post.id)}
                        disabled={deletingId === post.id}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Main feed table (API-sourced) */}
      {feedQuery.data && showApiFeed && filteredFeed.length === 0 && filteredDbOnly.length === 0 && (
        <EmptyState
          title={`No ${channel.name} posts`}
          description={
            filter === 'tracked'
              ? `No tracked posts found. Use the Stories page to create a ${channel.name} post.`
              : filter === 'untracked'
                ? 'No untracked posts found.'
                : 'No posts yet.'
          }
        />
      )}

      {showApiFeed && filteredFeed.length > 0 && (
        <>
          <div className="overflow-x-auto bg-white rounded-lg border border-neutral-200 shadow-sm">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50">
                  <th scope="col" className="text-left px-3 py-2 font-medium text-neutral-500">
                    Post Text
                  </th>
                  <th scope="col" className="text-left px-3 py-2 font-medium text-neutral-500">
                    Source
                  </th>
                  <th scope="col" className="hidden md:table-cell text-left px-3 py-2 font-medium text-neutral-500">
                    Posted
                  </th>
                  <th scope="col" className="hidden lg:table-cell text-right px-3 py-2 font-medium text-neutral-500">
                    Engagement
                  </th>
                  <th scope="col" className="w-10 px-3 py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredFeed.map(item => {
                  const key = channel.itemKey(item)
                  const isExpanded = expandedKey === key
                  const webUrl = channel.webUrl(item)
                  return (
                    <tr
                      key={key}
                      className={`border-b border-neutral-100 last:border-0 group cursor-pointer ${isExpanded ? 'bg-neutral-50' : 'hover:bg-neutral-50'}`}
                      onClick={() => setExpandedKey(isExpanded ? null : key)}
                    >
                      <td className="px-3 py-2 max-w-[350px]">
                        {isExpanded ? (
                          <div className="text-neutral-700 whitespace-pre-wrap">{item.text}</div>
                        ) : (
                          <p className="text-neutral-700 truncate">{item.text}</p>
                        )}
                        {item.storyTitle && (
                          <p className="text-xs text-neutral-500 mt-0.5 truncate">
                            {item.storyTitle}
                            {item.issueName && <span className="text-neutral-400"> / {item.issueName}</span>}
                          </p>
                        )}
                        {channel.share.is(item) && (
                          <span className="inline-flex items-center gap-1 text-xs text-neutral-400 mt-0.5">
                            <ArrowPathIcon className="h-3 w-3" /> {channel.share.label}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {item.trackedPostId ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Tracked</span>
                        ) : (
                          <span className="text-xs text-neutral-400">Untracked</span>
                        )}
                      </td>
                      <td className="hidden md:table-cell px-3 py-2 text-neutral-500 whitespace-nowrap">{formatRelativeTime(channel.postedAt(item))}</td>
                      <td className="hidden lg:table-cell px-3 py-2 text-right text-neutral-500 whitespace-nowrap tabular-nums">{channel.engagement(item)}</td>
                      <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-0.5">
                          {webUrl && (
                            <a
                              href={webUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={`View on ${channel.name}`}
                              aria-label={`View on ${channel.name}`}
                              className={`rounded p-1 text-neutral-400 ${channel.linkHoverClass} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500`}
                            >
                              <ArrowTopRightOnSquareIcon className="h-5 w-5" />
                            </a>
                          )}
                          {item.trackedPostId && (
                            <ActionIconButton
                              icon={TrashIcon}
                              label="Delete"
                              variant="danger"
                              onClick={() => handleDelete(item.trackedPostId!)}
                              disabled={deletingId === item.trackedPostId}
                            />
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Load More */}
          {next && (
            <div className="mt-4 flex justify-center">
              <Button variant="secondary" onClick={handleLoadMore} loading={loadingMore}>
                Load More
              </Button>
            </div>
          )}
        </>
      )}
    </>
  )
}

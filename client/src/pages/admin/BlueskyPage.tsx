import type { BlueskyFeedItem } from '@shared/types'
import { adminApi } from '../../lib/admin-api'
import { blueskyPostUrl } from '../../lib/bluesky'
import { SocialChannelPage, type SocialChannel } from '../../components/admin/social/SocialChannelPage'

const blueskyChannel: SocialChannel<BlueskyFeedItem> = {
  name: 'Bluesky',
  feedQueryKey: 'blueskyFeed',
  getFeed: async cursor => {
    const result = await adminApi.bluesky.getFeed(cursor ? { cursor, limit: 25 } : { limit: 25 })
    return { feed: result.feed, next: result.cursor, dbOnlyPosts: result.dbOnlyPosts }
  },
  deletePost: postId => adminApi.bluesky.deletePost(postId),
  refreshMetrics: () => adminApi.bluesky.refreshMetrics(),
  itemKey: item => item.uri,
  postedAt: item => item.indexedAt,
  engagement: item => `${item.likeCount}L ${item.repostCount}R ${item.replyCount}C ${item.quoteCount}Q`,
  averaged: { label: 'Avg Likes', count: item => item.likeCount },
  share: { label: 'Repost', is: item => item.isRepost },
  webUrl: item => blueskyPostUrl(item.uri),
  linkHoverClass: 'hover:text-blue-600',
}

export default function BlueskyPage() {
  return <SocialChannelPage channel={blueskyChannel} />
}

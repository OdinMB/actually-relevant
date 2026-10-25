import type { MastodonFeedItem } from '@shared/types'
import { adminApi } from '../../lib/admin-api'
import { SocialChannelPage, type SocialChannel } from '../../components/admin/social/SocialChannelPage'

const mastodonChannel: SocialChannel<MastodonFeedItem> = {
  name: 'Mastodon',
  feedQueryKey: 'mastodonFeed',
  getFeed: async maxId => {
    const result = await adminApi.mastodon.getFeed(maxId ? { maxId, limit: 25 } : { limit: 25 })
    return { feed: result.feed, next: result.nextMaxId, dbOnlyPosts: result.dbOnlyPosts }
  },
  deletePost: postId => adminApi.mastodon.deletePost(postId),
  refreshMetrics: () => adminApi.mastodon.refreshMetrics(),
  itemKey: item => item.id,
  postedAt: item => item.createdAt,
  engagement: item => `${item.favouriteCount}F ${item.boostCount}B ${item.replyCount}R`,
  averaged: { label: 'Avg Favorites', count: item => item.favouriteCount },
  share: { label: 'Reblog', is: item => item.isReblog },
  webUrl: item => item.url || null,
  linkHoverClass: 'hover:text-purple-600',
}

export default function MastodonPage() {
  return <SocialChannelPage channel={mastodonChannel} />
}

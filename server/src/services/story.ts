/**
 * The story service's public face. The code lives in cohesive modules; this barrel keeps the one
 * import path (`services/story.js`) that routes, jobs and the tests' `vi.mock` calls use.
 *
 * - storyQueries.ts   admin list and filters, by-id reads, status counts, pipeline id queries
 * - storyWrites.ts    create, admin edit, editor status moves (via storyLifecycle.ts), delete
 * - publicStories.ts  public listing, story by slug, cluster redirect/sources, homepage buckets
 * - storySearch.ts    hybrid (semantic + text) search
 * - relatedStories.ts related stories, their LLM re-rank and cache
 * - storySelect.ts    the public field selection
 *
 * Code inside these modules imports its siblings directly, never this barrel, so a test that
 * mocks `services/story.js` replaces what its caller sees and nothing inside the service.
 */
export { publishedStoryWhere, getStories, getStoriesByIds, getStoryById, getExistingUrls, getStoryStats, getStoryIdsByStatus } from './storyQueries.js'
export {
  createStory,
  type StoryUpdate,
  updateStory,
  updateStoryStatus,
  bulkUpdateStatus,
  publishStory,
  rejectStory,
  deleteStory,
  dissolveCluster,
} from './storyWrites.js'
export { getPublishedStories, getPublishedStoryBySlug, getClusterRedirectSlug, getClusterMembers, getHomepageData } from './publicStories.js'
export { forgetRelatedStories, getRelatedStories } from './relatedStories.js'
export { PUBLIC_STORY_SELECT } from './storySelect.js'

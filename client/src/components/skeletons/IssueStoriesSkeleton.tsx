import StoryCardSkeleton from './StoryCardSkeleton'

/**
 * Skeleton placeholder for IssuePage's story list (layout A), on its own while the list loads
 * under a loaded issue, and inside IssuePageSkeleton.
 */
export default function IssueStoriesSkeleton() {
  return (
    <div className="grid gap-5 md:grid-cols-3 mb-8">
      <div className="md:col-span-2">
        <StoryCardSkeleton variant="featured" />
      </div>
      <div className="space-y-3">
        <StoryCardSkeleton variant="compact" />
        <StoryCardSkeleton variant="compact" />
        <StoryCardSkeleton variant="compact" />
      </div>
    </div>
  )
}

import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { Story, StoryStatus } from '@shared/types'
import { Button } from '../ui/Button'
import { useDissolveCluster } from '../../hooks/useStories'
import { formatStatus, formatDate } from '../../lib/constants'
import { blueskyPostUrl } from '../../lib/bluesky'
import { EDITOR_HEADING, EDITOR_SECTION } from './storyEditorClasses'

/*
 * The story page's sections beside its fields: what the story was crawled from, its dedup cluster,
 * and its social posts. None of them is part of the form's fields; each acts on its own.
 */

const ACCESS_TIER_LABELS: Record<string, string> = {
  locked: 'Paywall locked (rejected at crawl)',
  metered: 'Marked paid, full text received',
  free: 'Free',
  unknown: 'Not marked by the publisher',
}

function formatAccessTier(tier: string | null): string {
  return tier ? (ACCESS_TIER_LABELS[tier] ?? tier) : 'Not classified'
}

const TEXT_ACTION =
  'text-sm font-medium text-brand-700 hover:text-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded'
const POST_LINK = 'text-brand-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded'

/** The source the story was crawled from (read-only), with its text behind a toggle. */
export function SourceSection({ story }: { story: Story }) {
  const [contentExpanded, setContentExpanded] = useState(false)
  const headingId = `source-${story.id}`
  const contentId = `source-content-${story.id}`
  return (
    <section aria-labelledby={headingId} className={`${EDITOR_SECTION} space-y-2`}>
      <h2 id={headingId} className={EDITOR_HEADING}>
        Source
      </h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
        <dt className="text-neutral-500">Title</dt>
        <dd className="text-neutral-900">{story.sourceTitle || '—'}</dd>
        <dt className="text-neutral-500">Published</dt>
        <dd className="text-neutral-900">{formatDate(story.sourceDatePublished)}</dd>
        <dt className="text-neutral-500">Feed</dt>
        <dd className="text-neutral-900">{story.feed?.title || '—'}</dd>
        <dt className="text-neutral-500">Access</dt>
        <dd className="text-neutral-900">{formatAccessTier(story.accessTier)}</dd>
        <dt className="text-neutral-500">URL</dt>
        <dd className="text-neutral-900 truncate">
          <a href={story.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:text-brand-800 underline">
            {story.sourceUrl}
          </a>
        </dd>
      </dl>
      {story.sourceContent && (
        <div className="pt-2">
          <button
            type="button"
            onClick={() => setContentExpanded(!contentExpanded)}
            aria-expanded={contentExpanded}
            aria-controls={contentId}
            className={TEXT_ACTION}
          >
            {contentExpanded ? 'Hide content' : 'Show source content'}
          </button>
          <div
            id={contentId}
            hidden={!contentExpanded}
            className="mt-2 text-sm text-neutral-700 whitespace-pre-wrap max-h-96 overflow-y-auto border border-neutral-200 rounded p-3"
          >
            {story.sourceContent}
          </div>
        </div>
      )}
    </section>
  )
}

/** The story's dedup cluster: its role and the other members, managed on the Clusters page; or a link to start one. */
export function ClusterSection({ story }: { story: Story }) {
  const [confirmDissolve, setConfirmDissolve] = useState(false)
  const dissolveCluster = useDissolveCluster()
  const headingId = `cluster-${story.id}`
  const cluster = story.clusterId ? story.cluster : null

  return (
    <section aria-labelledby={headingId} className={`${EDITOR_SECTION} space-y-2`}>
      <h2 id={headingId} className={EDITOR_HEADING}>
        Cluster
      </h2>
      {cluster ? (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-neutral-500">Role</dt>
            <dd className="text-neutral-900">
              {cluster.primaryStoryId === story.id ? (
                <span className="inline-flex items-center gap-1 text-green-700 font-medium">Primary</span>
              ) : (
                <span className="text-purple-700">Member</span>
              )}
            </dd>
            <dt className="text-neutral-500">Members</dt>
            <dd className="text-neutral-900">{cluster._count.stories} stories</dd>
          </dl>
          <div className="pt-1">
            <p className="text-xs font-medium text-neutral-500 mb-1">Other stories in cluster:</p>
            <ul className="space-y-0.5">
              {cluster.stories
                .filter(s => s.id !== story.id)
                .map(s => (
                  <li key={s.id} className="text-sm text-neutral-700 flex items-center gap-1.5">
                    <span className="truncate">{s.title || s.sourceTitle}</span>
                    {s.id === cluster.primaryStoryId && <span className="text-xs text-green-700 font-medium shrink-0">(Primary)</span>}
                    <span className="text-xs text-neutral-500 shrink-0">{formatStatus(s.status as StoryStatus)}</span>
                  </li>
                ))}
            </ul>
          </div>
          <div className="pt-2 flex flex-wrap items-center gap-3">
            <Link to={`/admin/clusters?open=${story.clusterId}`} className={TEXT_ACTION}>
              Manage cluster
            </Link>
            {confirmDissolve ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-red-600">Dissolve cluster and restore members to analyzed?</span>
                <button
                  type="button"
                  onClick={() => {
                    dissolveCluster.mutate(story.id, { onSuccess: () => setConfirmDissolve(false) })
                  }}
                  disabled={dissolveCluster.isPending}
                  className="text-sm font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                >
                  {dissolveCluster.isPending ? 'Dissolving...' : 'Confirm'}
                </button>
                <button type="button" onClick={() => setConfirmDissolve(false)} className="text-sm text-neutral-500 hover:text-neutral-700">
                  Cancel
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmDissolve(true)} className="text-sm text-red-600 hover:text-red-700 font-medium">
                Dissolve cluster
              </button>
            )}
          </div>
        </>
      ) : (
        <Link to={`/admin/clusters?create=${story.id}`} className={TEXT_ACTION}>
          Create cluster with this story
        </Link>
      )}
    </section>
  )
}

interface SocialPostsSectionProps {
  story: Story
  onBlueskyGenerate?: (storyId: string) => void
  onMastodonGenerate?: (storyId: string) => void
}

/** A published story's Bluesky and Mastodon posts: a link to the post once made, otherwise the button that drafts it. */
export function SocialPostsSection({ story, onBlueskyGenerate, onMastodonGenerate }: SocialPostsSectionProps) {
  if (story.status !== 'published' || (!onBlueskyGenerate && !onMastodonGenerate)) return null
  const headingId = `social-${story.id}`
  const blueskyUri = story.blueskyPosts?.[0]?.postUri
  const blueskyUrl = blueskyUri ? blueskyPostUrl(blueskyUri) : null
  const mastodonUrl = story.mastodonPosts?.[0]?.statusUrl ?? null

  return (
    <section aria-labelledby={headingId} className={`${EDITOR_SECTION} space-y-3`}>
      <h2 id={headingId} className={EDITOR_HEADING}>
        Social posts
      </h2>
      {onBlueskyGenerate && (
        <div>
          <h3 className="text-sm font-medium text-neutral-900 mb-1">Bluesky</h3>
          {(story._count?.blueskyPosts ?? 0) > 0 ? (
            <p className="text-sm text-neutral-500">
              This story has been posted to Bluesky.
              {blueskyUrl && (
                <>
                  {' '}
                  <a href={blueskyUrl} target="_blank" rel="noopener noreferrer" className={POST_LINK}>
                    View post
                  </a>
                </>
              )}
            </p>
          ) : (
            <Button type="button" variant="secondary" onClick={() => onBlueskyGenerate(story.id)}>
              Generate Bluesky Post
            </Button>
          )}
        </div>
      )}
      {onMastodonGenerate && (
        <div>
          <h3 className="text-sm font-medium text-neutral-900 mb-1">Mastodon</h3>
          {(story._count?.mastodonPosts ?? 0) > 0 ? (
            <p className="text-sm text-neutral-500">
              This story has been posted to Mastodon.
              {mastodonUrl && (
                <>
                  {' '}
                  <a href={mastodonUrl} target="_blank" rel="noopener noreferrer" className={POST_LINK}>
                    View post
                  </a>
                </>
              )}
            </p>
          ) : (
            <Button type="button" variant="secondary" onClick={() => onMastodonGenerate(story.id)}>
              Generate Mastodon Post
            </Button>
          )}
        </div>
      )}
    </section>
  )
}

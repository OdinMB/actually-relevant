import { z } from 'zod'
import { createFeedSchema, updateFeedSchema } from './feed.js'

/**
 * A feed changeset: a JSON file of feed changes that an admin uploads, previews and applies in one
 * go (`.context/feed-management.md`, "Changesets"). The file names issues by slug and feeds by id,
 * RSS URL or exact title, so it never needs to know database ids. The client's copy of the format
 * constants and the agent instructions are in `shared/constants` and
 * `client/src/components/admin/feedChangesetInstructions.ts`.
 */

export const FEED_CHANGESET_FORMAT = 'actually-relevant/feed-changeset'
export const FEED_CHANGESET_VERSION = 1
export const MAX_FEED_CHANGES = 200
export const MAX_REASON_LENGTH = 500

const issueSlugSchema = z.string().min(1, 'Issue slug is required')

/** Exactly one of id, rssUrl or title (exact and case-sensitive), matched against every feed, active or not. */
const feedMatchSchema = z
  .object({
    id: z.string().uuid('Must be a feed id').optional(),
    rssUrl: z.string().url('Must be a valid URL').optional(),
    title: z.string().min(1).optional(),
  })
  .strict()
  .refine(match => [match.id, match.rssUrl, match.title].filter(key => key !== undefined).length === 1, 'Match needs exactly one of id, rssUrl or title')

const reasonSchema = z.string().trim().min(1, 'A reason is required').max(MAX_REASON_LENGTH, `Reason must be at most ${MAX_REASON_LENGTH} characters`)

/** The fields an update may set: those of PUT /api/admin/feeds/:id, with an issue slug for issueId. */
const feedUpdateFieldsSchema = updateFeedSchema
  .omit({ issueId: true })
  .extend({ issue: issueSlugSchema.optional() })
  .strict()
  .refine(fields => Object.keys(fields).length > 0, 'Set needs at least one field')

/** A new feed: the fields of POST /api/admin/feeds, with an issue slug for issueId. */
const newFeedFieldsSchema = createFeedSchema.omit({ issueId: true }).extend({ issue: issueSlugSchema }).strict()

export const feedChangeSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), feed: newFeedFieldsSchema, reason: reasonSchema }).strict(),
  z.object({ action: z.literal('update'), match: feedMatchSchema, set: feedUpdateFieldsSchema, reason: reasonSchema }).strict(),
  // Deletes as DELETE /api/admin/feeds/:id does: outright without stories, deactivated with them.
  z.object({ action: z.literal('delete'), match: feedMatchSchema, reason: reasonSchema }).strict(),
])

export type FeedChange = z.infer<typeof feedChangeSchema>
export type FeedChangeAction = FeedChange['action']
export type FeedMatch = z.infer<typeof feedMatchSchema>

/**
 * The file around the changes. Each change is checked on its own (`feedChangeSchema`) when the
 * changeset is resolved, so that one malformed change is reported beside the others instead of
 * refusing the whole file.
 */
export const feedChangesetSchema = z
  .object({
    format: z.literal(FEED_CHANGESET_FORMAT),
    version: z.literal(FEED_CHANGESET_VERSION),
    title: z.string().max(200).optional(),
    createdAt: z.string().max(40).optional(),
    changes: z.array(z.unknown()).min(1, 'The changeset has no changes').max(MAX_FEED_CHANGES, `At most ${MAX_FEED_CHANGES} changes per changeset`),
  })
  .strict()

export type FeedChangeset = z.infer<typeof feedChangesetSchema>

/**
 * "A story belongs to an issue": its own issue, or else (no issue of its own) its feed's issue, is
 * that issue or a direct child of it. One rule, in the two forms the queries need: a Prisma where
 * clause and a raw-SQL condition on a `stories` row aliased `s`. `issueFilter.db.test.ts` holds them
 * to the same answers.
 */
import { Prisma } from '@prisma/client'

/** Prisma form: stories in the issue with this slug or in one of its children. */
export function storyInIssueWhere(issueSlug: string): Prisma.StoryWhereInput {
  const matches: Prisma.IssueWhereInput = { OR: [{ slug: issueSlug }, { parent: { slug: issueSlug } }] }
  return {
    OR: [{ issue: matches }, { issue: null, feed: { issue: matches } }],
  }
}

/** SQL form of the same rule, a bare condition on `s` (the caller writes the `AND`). */
export function storyInIssueSql(issueSlug: string): Prisma.Sql {
  return Prisma.sql`EXISTS (
    SELECT 1 FROM issues si LEFT JOIN issues sp ON sp.id = si.parent_id
    WHERE si.id = COALESCE(s.issue_id, (SELECT sf.issue_id FROM feeds sf WHERE sf.id = s.feed_id))
      AND (si.slug = ${issueSlug} OR sp.slug = ${issueSlug})
  )`
}

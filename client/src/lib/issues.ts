import type { Issue, Story } from '@shared/types'

/** What `issueTree` needs of an issue. */
export type IssueNode = Pick<Issue, 'id' | 'name' | 'slug' | 'parentId'>

/** Top-level issues by name, each with its sub-issues by name. A sub-issue whose parent is missing is left out. */
export function issueTree<T extends IssueNode>(issues: T[]): { parent: T; children: T[] }[] {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name)
  return issues
    .filter(issue => !issue.parentId)
    .sort(byName)
    .map(parent => ({ parent, children: issues.filter(child => child.parentId === parent.id).sort(byName) }))
}

/**
 * Resolves the top-level issue for a story, preferring story.issue over feed.issue
 * and resolving child issues to their parent.
 */
export function getTopLevelIssue(story: Story): { id: string; name: string } | null {
  const storyIssue = story.issue
  if (storyIssue) {
    if (storyIssue.parentId && storyIssue.parent) {
      return { id: storyIssue.parent.id, name: storyIssue.parent.name }
    }
    return { id: storyIssue.id, name: storyIssue.name }
  }

  const feedIssue = story.feed?.issue
  if (feedIssue) {
    if (feedIssue.parentId && feedIssue.parent) {
      return { id: feedIssue.parent.id, name: feedIssue.parent.name }
    }
    if (feedIssue.id) {
      return { id: feedIssue.id, name: feedIssue.name }
    }
    return { id: feedIssue.name, name: feedIssue.name }
  }

  return null
}

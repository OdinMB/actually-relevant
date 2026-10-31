/**
 * The machine markers in a newsletter issue's stored markdown (`newsletters.content`), for every
 * reader of it: the email template (`newsletter.ts`), the web edition and its story matching
 * (`newsletterArchive.ts`).
 *
 * - `## <headline> {story:<id>}`: a story heading, carrying the id of the story it presents, so the
 *   web edition finds the story whatever the heading says (a title edited after generation, or a
 *   heading edited by hand). Issues generated before the marker existed have plain headings.
 * - `{feed:<id>}` at the start of a story's metadata line: the publisher favicon in the email.
 * - ` {issue-slug}` after a `# ` section heading: the section's colored dot in the email.
 */

const STORY_MARKER = /[ \t]*\{story:([^}\s]+)\}[ \t]*$/

/** The `## ` heading line for a story. */
export function storyHeading(headline: string, storyId: string): string {
  return `## ${headline} {story:${storyId}}`
}

/** A `## ` heading line's text without its marker, and the story id it names (null: none). */
export function parseStoryHeading(line: string): { headline: string; storyId: string | null } {
  const text = line.trim().replace(/^##[ \t]+/, '')
  const marker = STORY_MARKER.exec(text)
  if (!marker) return { headline: text.trim(), storyId: null }
  return { headline: text.slice(0, marker.index).trim(), storyId: marker[1]! }
}

/** Every `## ` heading line in `content`, in order, parsed. */
function headingLines(content: string): { headline: string; storyId: string | null }[] {
  return content
    .split('\n')
    .filter(line => line.trimStart().startsWith('## '))
    .map(parseStoryHeading)
}

/** Every story heading the email shows, in order, marked or not (a heading with no text shows nothing). */
export function storyHeadings(content: string): { headline: string; storyId: string | null }[] {
  return headingLines(content).filter(({ headline }) => headline)
}

/** Every marked story heading in `content`, in order, with the headline it shows. */
export function storyHeadlines(content: string): { storyId: string; headline: string }[] {
  return headingLines(content).flatMap(({ headline, storyId }) => (storyId ? [{ storyId, headline }] : []))
}

/** The stored markdown as the web edition shows it: without any of the markers above. */
export function toWebMarkdown(content: string): string {
  return content
    .replace(/\{feed:[^}\s]*\}[ \t]*/g, '')
    .replace(/^(##[ \t].*?)[ \t]*\{story:[^}\s]*\}[ \t]*$/gm, '$1')
    .replace(/^(#[ \t].*?)[ \t]*\{[a-z0-9-]+\}[ \t]*$/gm, '$1')
}

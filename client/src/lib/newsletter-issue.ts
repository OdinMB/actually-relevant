/**
 * Reading a newsletter issue's web Markdown (`toWebMarkdown()` in the server's
 * `newsletterContent.ts`) the way the email template reads the stored one, for the issue page's
 * email-like look: which category a `# ` section is, and a quote's text and attribution.
 */

/** The tinted page around the issue page's card (and its skeleton's): the card goes edge to edge on phones. */
export const ISSUE_PAGE_CLASS = 'bg-neutral-100 sm:px-4 sm:py-10 md:py-14'

/** The issue's white card, as wide as the email's. */
export const ISSUE_CARD_CLASS = 'mx-auto max-w-[680px] overflow-hidden bg-white sm:rounded-lg sm:shadow-sm'

/** A category name as a slug: "Planet & Climate" → "planet-climate". */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * The category slug of a `# ` section heading. The web Markdown has lost the email's ` {slug}`
 * marker, so the heading's name is looked up among the site's categories (top level and children)
 * and, while they are not loaded or none has that name, slugified the way the category slugs are.
 */
export function sectionSlug(name: string, categories: { name: string; slug: string; children?: { name: string; slug: string }[] }[] = []): string {
  const wanted = name.trim()
  for (const category of categories.flatMap(c => [c, ...(c.children ?? [])])) {
    if (category.name.trim() === wanted) return category.slug
  }
  return slugify(wanted)
}

/**
 * A blockquote's plain text as the quote and its attribution: the content writes a quote as
 * `> "<quote>"` with `> — <attribution>` on the next line. Null when the text is not shaped so
 * (a quote edited by hand), which the page then shows as it stands.
 */
export function parseQuote(text: string): { quote: string; attribution: string } | null {
  const match = /^\s*([\s\S]*?)\s*\n\s*[—–]\s*(.+?)\s*$/.exec(text)
  if (!match) return null
  const quote = match[1]!.replace(/^["“]\s*|\s*["”]$/g, '').trim()
  const attribution = match[2]!.trim()
  if (!quote || !attribution) return null
  return { quote, attribution }
}

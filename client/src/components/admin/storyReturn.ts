/*
 * The way back from a story's admin page to the page it was opened from, as that page was: the path
 * and search (the stories list keeps its filters, sort and page in its URL), the history entry whose
 * scroll offset to put back (`useAdminScroll`), and the back link's label. It travels as the
 * location state of the link to the story, so the story's own address stays clean; a page opened
 * without it (a bookmark, a typed address) goes back to the stories list's defaults.
 */

export const STORIES_LIST = '/admin/stories'

/** The way back, as a link to a story's page carries it in `state.returnTo`. */
export interface StoryReturn {
  /** Path and search of the page, e.g. `/admin/stories?status=all&page=3`. */
  path: string
  /** The page, as the back link names it: "Back to {label}". */
  label: string
  /** The history entry the story was opened from, whose scroll offset the back link puts back. */
  entry?: string
}

/** The pages a story's page is opened from, by path, with the name the back link gives them. */
const LABELS: [RegExp, string][] = [
  [/^\/admin\/stories\/?$/, 'stories'],
  [/^\/admin\/newsletters\/[^/]+\/?$/, 'newsletter'],
  [/^\/admin\/podcasts\/[^/]+\/?$/, 'podcast'],
  [/^\/admin\/overviews\/[^/]+\/?$/, 'overview'],
]
const UNNAMED = 'previous page'
const KNOWN_LABELS = new Set([...LABELS.map(([, label]) => label), UNNAMED])

export function storyPath(id: string): string {
  return `${STORIES_LIST}/${encodeURIComponent(id)}`
}

/** The location state for a link to a story's page from the page at `from` (without a `key` where that entry is replaced). */
export function returnState(from: { pathname: string; search: string; key?: string }): { returnTo: StoryReturn } {
  const label = LABELS.find(([path]) => path.test(from.pathname))?.[1] ?? UNNAMED
  return { returnTo: { path: from.pathname + from.search, label, entry: from.key } }
}

/** The way back in a story page's location state, if it holds a valid one (history state can hold anything). */
function readReturn(state: unknown): StoryReturn | null {
  if (typeof state !== 'object' || state === null) return null
  const returnTo = (state as { returnTo?: unknown }).returnTo
  if (typeof returnTo !== 'object' || returnTo === null) return null
  const { path, label, entry } = returnTo as Record<string, unknown>
  if (typeof path !== 'string' || !path.startsWith('/admin') || path.startsWith('//')) return null
  if (typeof label !== 'string' || !KNOWN_LABELS.has(label)) return null
  if (entry !== undefined && typeof entry !== 'string') return null
  return { path, label, entry }
}

/** Where a story's page goes back to (its back link, Cancel and Save), from its location state. */
export function backLink(state: unknown): { to: string; label: string; state: { restoreScrollOf: string } | undefined } {
  const way = readReturn(state) ?? { path: STORIES_LIST, label: 'stories' }
  return { to: way.path, label: `Back to ${way.label}`, state: way.entry ? { restoreScrollOf: way.entry } : undefined }
}

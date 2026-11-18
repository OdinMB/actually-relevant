import type { PublicStoryUpdate } from '@shared/types'
import { FOCUS_RING, TEXT_LINK } from '../../lib/control-classes'
import type { SourcesById } from './Citation'
import { CitedSentences } from './CitedText'

/**
 * A researched story's Updates (ADR-0068, "Where Updates show"; `.context/public-website.md`,
 * "Updates"): a ruled section after Caveats, the updates newest first, each with its day, its note
 * and, per section it changed, the earlier text in a closed native disclosure with the citations it
 * carried, so it opens by keyboard and screen reader with no script. The "Updated" mark after a
 * rewritten paragraph or point and the header's "Updated <date>" link lead here. Nothing renders for
 * a story never updated, which every story is until research passes are switched on. The notes and
 * the earlier texts are AI-written and fall under the story's own AI label; they carry
 * `data-ai-generated="updates"`, the API field they come in.
 */

/** The section's anchor, which the marks and the header link point to. */
export const UPDATES_ID = 'updates'

/** The reader-facing words of the Updates (drafts until the owner approves them). */
export const UPDATE_COPY = {
  heading: 'Updates',
  earlier: (section: string) => `Earlier version of ${section}`,
  removed: (section: string) => `Removed: ${section}`,
  mark: 'Updated',
  /** The mark's accessible name: its visible word, then where it leads. */
  markName: 'Updated: see what changed under Updates',
  /** The header's link, before the newest Update's day. */
  headerLink: 'Updated',
}

/** The mark's accessible name. */
export const updatedLinkText = UPDATE_COPY.markName

const LONG_DATE: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }

/** An Update's day, `YYYY-MM-DD`, as readers read it. */
export function updateDay(date: string, options: Intl.DateTimeFormatOptions = LONG_DATE): string {
  const day = new Date(`${date}T00:00:00Z`)
  return Number.isNaN(day.getTime()) ? date : day.toLocaleDateString('en-US', { ...options, timeZone: 'UTC' })
}

/** Where a section sat on the page, in readers' words: "paragraph 2", "Why This Matters, point 1". */
export function sectionName(label: string): string {
  if (label === 'Title') return 'the headline'
  if (label === 'Key quote') return 'the key quote'
  const paragraph = /^Story paragraph (\d+)$/.exec(label)
  if (paragraph) return `paragraph ${paragraph[1]}`
  const point = /^(Why This Matters|Caveat) (\d+)$/.exec(label)
  if (point) return `${point[1] === 'Caveat' ? 'Caveats' : point[1]}, point ${point[2]}`
  return label
}

const SUMMARY = `cursor-pointer text-sm text-brand-700 hover:text-brand-800 rounded ${FOCUS_RING}`

function UpdateEntry({ update }: { update: PublicStoryUpdate }) {
  const sources: SourcesById = new Map(update.sources.map(s => [s.id, s]))
  const earlier = update.changes.filter(c => c.before !== null)
  return (
    <li>
      <p className="text-sm font-semibold text-neutral-700">
        <time dateTime={update.date}>{updateDay(update.date)}</time>
      </p>
      <div className="prose mt-1">
        <p>
          <CitedSentences items={[update.note]} sources={sources} />
        </p>
      </div>
      {earlier.length > 0 && (
        <div className="mt-2 space-y-2">
          {earlier.map(change => (
            <details key={change.section} data-ai-generated="updates">
              <summary className={SUMMARY}>
                {change.removed ? UPDATE_COPY.removed(sectionName(change.section)) : UPDATE_COPY.earlier(sectionName(change.section))}
              </summary>
              <div className="prose mt-2 border-l-2 border-neutral-200 pl-4 text-neutral-600">
                <p>
                  <CitedSentences items={[change.before!]} sources={sources} />
                </p>
              </div>
            </details>
          ))}
        </div>
      )}
    </li>
  )
}

export function StoryUpdates({ updates }: { updates: PublicStoryUpdate[] }) {
  if (updates.length === 0) return null
  return (
    <section id={UPDATES_ID} aria-labelledby="updates-heading" className="mb-10 scroll-mt-24" data-ai-generated="updates">
      <h2 id="updates-heading" className="ruled-heading mb-6 !text-sm !tracking-wider">
        <span className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full shrink-0 bg-neutral-400" aria-hidden="true" />
          {UPDATE_COPY.heading}
        </span>
      </h2>
      <ol className="space-y-6">
        {updates.map((update, i) => (
          <UpdateEntry key={`${update.date}-${i}`} update={update} />
        ))}
      </ol>
    </section>
  )
}

/** The mark after a rewritten paragraph or point: a small link to the Updates section. */
export function UpdatedMark() {
  return (
    // The name starts with the visible word (WCAG 2.5.3) and says where the link leads. It sits in a
    // box one line tall and centers in it, as the citation chips before it do (Citation.tsx)
    <a
      href={`#${UPDATES_ID}`}
      aria-label={updatedLinkText}
      className={`ml-1 inline-flex min-h-[1lh] items-center whitespace-nowrap align-top text-xs font-medium ${TEXT_LINK}`}
    >
      {UPDATE_COPY.mark}
    </a>
  )
}

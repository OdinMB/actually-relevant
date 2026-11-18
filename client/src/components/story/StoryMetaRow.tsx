import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { PublicStoryDetail, ResearchedStory } from '@shared/types'
import FeedFavicon from '../FeedFavicon'
import AiBadge from '../ai/AiBadge'
import { AI_DISCLOSURE_COPY } from '../ai/aiDisclosureCopy'
import { SourceIcon } from '../research/SourceIcon'
import { outletName, sourceDate } from '../research/sourceText'
import { Tooltip } from '../ui/Tooltip'
import { FOCUS_RING, TEXT_LINK } from '../../lib/control-classes'

/*
 * The metadata row's text items (date, source, "Original article", AI label). From `md` up this
 * wrapper is `display: contents`, so they sit in the row with the actions and the "|" spans between
 * them. On phones it is a row of its own, the "|" spans are hidden, and each item after the date
 * draws its "|" with `::before` in the 28px gap in front of it (alt text '', so screen readers skip
 * it), about where the span stood. An item a wrap puts at the start of a line has its "|" left of
 * the row, and the row clips its left edge (`overflow-x-clip`) so no line starts with one. The row
 * reaches 4px past each side (`-mx-1 px-1`, and as much wider) so a focus ring at a line's start or
 * end stays visible.
 */
const META_TEXT_ROW = 'flex flex-wrap items-center gap-x-7 gap-y-1 basis-[calc(100%+0.5rem)] -mx-1 px-1 overflow-x-clip md:contents'
const PHONE_SEPARATOR =
  "max-md:relative max-md:before:absolute max-md:before:-left-4 max-md:before:top-1/2 max-md:before:-translate-y-1/2 max-md:before:text-neutral-300 max-md:before:content-['|'_/_'']"

const ROW_LINK = `text-brand-700 hover:text-brand-800 ${FOCUS_RING} rounded px-0.5`

const LONG_DATE: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric', year: 'numeric' }

/** The "|" between the row's items from `md` up; visual only, so screen readers don't read it out. */
export function MetaSeparator() {
  return (
    <span className="text-neutral-300 max-md:hidden" aria-hidden="true">
      |
    </span>
  )
}

/**
 * The publisher's name with its favicon, linking the article the story was found in. `children`
 * (", <date>") follow the name with no gap, so the comma sits right after it.
 */
function OriginalSourceLink({ story, children }: { story: PublicStoryDetail; children?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <FeedFavicon feedId={story.feed.id} />
      <span>
        <a href={story.sourceUrl} target="_blank" rel="noopener noreferrer" className={ROW_LINK}>
          {story.feed.displayTitle || story.feed.title}
          <span className="sr-only"> (opens in new tab)</span>
        </a>
        {children}
      </span>
    </span>
  )
}

/** A single-source story's items: our publish date, the publisher (and its date), "Original article". */
function PlainItems({ story }: { story: PublicStoryDetail }) {
  const displayDate = story.datePublished || story.dateCrawled
  return (
    <>
      <time dateTime={displayDate}>{new Date(displayDate).toLocaleDateString('en-US', LONG_DATE)}</time>
      <MetaSeparator />
      <span className={`inline-flex items-center ${PHONE_SEPARATOR}`}>
        <OriginalSourceLink story={story}>
          {story.sourceDatePublished && <>, {new Date(story.sourceDatePublished).toLocaleDateString('en-US', LONG_DATE)}</>}
        </OriginalSourceLink>
      </span>
      <MetaSeparator />
      <a href={story.sourceUrl} target="_blank" rel="noopener noreferrer" className={`${ROW_LINK} ${PHONE_SEPARATOR}`}>
        Original article
        <span className="sr-only"> (opens in new tab)</span>
      </a>
    </>
  )
}

/**
 * A researched story's items (owner, 2026-11-12, the mockup): where it was found and its source's
 * date, then "Sources:" and every source's icon side by side, each framed, 4 px apart (owner,
 * 2026-11-14, variant B), one link to the list. The icons are decorative, so the link's name gives
 * the count: "Sources: 6, see the list". Our publish date is dropped.
 *
 * Hovering an icon names its outlet in a `Tooltip` (owner, 2026-11-14), "Earlier on Actually
 * Relevant" for our earlier stories. The icons are no focus stops of their own and the row is
 * hidden from screen readers, so the link stays one stop with its count as its name; the names are
 * in the list it leads to. On a device that cannot hover the tooltips never show (a tap follows
 * the link).
 */
function ResearchedItems({ story, research }: { story: PublicStoryDetail; research: ResearchedStory }) {
  const original = research.sources.find(source => source.origin === 'original')
  const originalDate = original ? sourceDate(original) : null
  const sourceCount = research.sources.length
  const sourcesWord = sourceCount === 1 ? 'Source' : 'Sources'
  return (
    <>
      <span className="inline-flex flex-wrap items-center gap-x-1.5">
        Found on{' '}
        <OriginalSourceLink story={story}>
          {original?.date && originalDate && (
            <>
              , <time dateTime={original.date}>{originalDate}</time>
            </>
          )}
        </OriginalSourceLink>
      </span>
      <MetaSeparator />
      <a
        href="#sources"
        aria-label={`${sourcesWord}: ${sourceCount}, see the list`}
        className={`inline-flex min-h-6 items-center gap-1.5 ${ROW_LINK} ${PHONE_SEPARATOR}`}
      >
        {sourcesWord}:
        <span aria-hidden="true" className="inline-flex flex-wrap items-center gap-1 [@media(hover:none)]:[&_[role=tooltip]]:hidden">
          {research.sources.map(source => (
            <Tooltip key={source.id} content={outletName(source)}>
              {() => <SourceIcon source={source} framed />}
            </Tooltip>
          ))}
        </span>
      </a>
    </>
  )
}

/**
 * The text items of the row under the headline: the single-source or the researched items, then the
 * AI label. A single-source label is plain text followed by "How it works"; a researched label links
 * its own opening words to the methodology page's research section instead (owner, 2026-11-13). The
 * label keys on `researched` (the text fields carry researched text), the items on the cited version.
 */
export function StoryMetaRow({ story, research }: { story: PublicStoryDetail; research: ResearchedStory | null }) {
  const researchedLabel = AI_DISCLOSURE_COPY.researchedStoryLabel
  const storyLabel = story.researched ? researchedLabel : AI_DISCLOSURE_COPY.storyLabel
  // The badge is the label's only "AI"; screen readers hear it as the word, so the sentence reads the same aloud
  const badge = <AiBadge accessibleName={AI_DISCLOSURE_COPY.badgeText} className="ml-1 align-middle" />
  return (
    <div className={META_TEXT_ROW}>
      {research ? <ResearchedItems story={story} research={research} /> : <PlainItems story={story} />}
      <MetaSeparator />
      <span className={`inline-flex flex-wrap items-center gap-x-2 ${PHONE_SEPARATOR}`}>
        {story.researched ? (
          <span>
            <Link to={researchedLabel.href} className={TEXT_LINK}>
              {researchedLabel.linkText}
            </Link>
            {researchedLabel.lead.slice(researchedLabel.linkText.length)} {badge}
            {researchedLabel.tail}
          </span>
        ) : (
          <>
            {/* AI label as plain text, so it doesn't read as one more navigation link */}
            <span>
              {storyLabel.lead} {badge}
              {storyLabel.tail}
            </span>
            <Link to={AI_DISCLOSURE_COPY.howItWorksHref} className={TEXT_LINK}>
              {AI_DISCLOSURE_COPY.howItWorksLinkText}
            </Link>
          </>
        )}
      </span>
    </div>
  )
}

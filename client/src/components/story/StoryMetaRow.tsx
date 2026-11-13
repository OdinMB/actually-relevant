import { Link } from 'react-router-dom'
import type { PublicStoryDetail, ResearchedStory } from '@shared/types'
import FeedFavicon from '../FeedFavicon'
import AiBadge from '../ai/AiBadge'
import { AI_DISCLOSURE_COPY } from '../ai/aiDisclosureCopy'
import { SourceIcons } from '../research/SourceIcon'
import { sourceDate } from '../research/sourceText'
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

/** The publisher's name with its favicon, linking the article the story was found in. */
function OriginalSourceLink({ story }: { story: PublicStoryDetail }) {
  return (
    <>
      <FeedFavicon feedId={story.feed.id} />
      <a href={story.sourceUrl} target="_blank" rel="noopener noreferrer" className={ROW_LINK}>
        {story.feed.displayTitle || story.feed.title}
        <span className="sr-only"> (opens in new tab)</span>
      </a>
    </>
  )
}

/** A single-source story's items: our publish date, the publisher (and its date), "Original article". */
function PlainItems({ story }: { story: PublicStoryDetail }) {
  const displayDate = story.datePublished || story.dateCrawled
  return (
    <>
      <time dateTime={displayDate}>{new Date(displayDate).toLocaleDateString('en-US', LONG_DATE)}</time>
      <MetaSeparator />
      <span className={`inline-flex items-center gap-1.5 ${PHONE_SEPARATOR}`}>
        <OriginalSourceLink story={story} />
        {story.sourceDatePublished && <>, {new Date(story.sourceDatePublished).toLocaleDateString('en-US', LONG_DATE)}</>}
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
 * date, then the sources' icons and "N sources", one link to the list (its name the count, the icons
 * being decorative); our publish date is dropped.
 */
function ResearchedItems({ story, research }: { story: PublicStoryDetail; research: ResearchedStory }) {
  const original = research.sources.find(source => source.origin === 'original')
  const originalDate = original ? sourceDate(original) : null
  const sourceCount = research.sources.length
  return (
    <>
      <span className="inline-flex flex-wrap items-center gap-x-1.5">
        Initially found on{' '}
        <span className="inline-flex items-center gap-1.5">
          <OriginalSourceLink story={story} />
          {original?.date && originalDate && (
            <>
              , <time dateTime={original.date}>{originalDate}</time>
            </>
          )}
        </span>
      </span>
      <MetaSeparator />
      <a href="#sources" className={`inline-flex min-h-6 items-center gap-1.5 ${ROW_LINK} ${PHONE_SEPARATOR}`}>
        <SourceIcons sources={research.sources} />
        {sourceCount} {sourceCount === 1 ? 'source' : 'sources'}
      </a>
    </>
  )
}

/**
 * The text items of the row under the headline: the single-source or the researched items, then the
 * AI label and "How it works". The label keys on `researched` (the text fields carry researched
 * text), the items on the cited version.
 */
export function StoryMetaRow({ story, research }: { story: PublicStoryDetail; research: ResearchedStory | null }) {
  const storyLabel = story.researched ? AI_DISCLOSURE_COPY.researchedStoryLabel : AI_DISCLOSURE_COPY.storyLabel
  return (
    <div className={META_TEXT_ROW}>
      {research ? <ResearchedItems story={story} research={research} /> : <PlainItems story={story} />}
      <MetaSeparator />
      {/* AI label as plain text, so it doesn't read as one more navigation link */}
      <span className={`inline-flex flex-wrap items-center gap-x-2 ${PHONE_SEPARATOR}`}>
        {/* The badge is the label's only "AI"; screen readers hear it as the word, so the sentence reads the same aloud */}
        <span>
          {storyLabel.lead} <AiBadge accessibleName={AI_DISCLOSURE_COPY.badgeText} className="align-middle" />
          {storyLabel.tail}
        </span>
        <Link to={AI_DISCLOSURE_COPY.howItWorksHref} className={TEXT_LINK}>
          {AI_DISCLOSURE_COPY.howItWorksLinkText}
        </Link>
      </span>
    </div>
  )
}

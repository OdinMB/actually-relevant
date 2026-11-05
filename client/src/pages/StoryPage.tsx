import { useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import Markdown from 'react-markdown'
import { usePublicStory, useStoryAppearances } from '../hooks/usePublicStories'
import { getCategoryColor, shiftHex } from '../lib/category-colors'
import { parsePoints } from '../lib/parse-points'
import { markdownToPlainText } from '../lib/plainText'
import { getTitleLabel, getHeadline } from '../lib/title-label'
import { markAsRead } from '../lib/reading-history'
import FeedFavicon from '../components/FeedFavicon'
import BookmarkButton from '../components/BookmarkButton'
import ShareButtons from '../components/ShareButtons'
import { useFeedback } from '../components/FeedbackProvider'
import { StoryProductButtons } from '../components/CrossLinks'
import StoryAppearances from '../components/StoryAppearances'
import RelatedStories from '../components/RelatedStories'
import AlsoCoveredBy from '../components/AlsoCoveredBy'
import AiBadge from '../components/ai/AiBadge'
import { AI_DISCLOSURE_COPY, quoteAttributionLine } from '../components/ai/aiDisclosureCopy'
import { StoryPageSkeleton } from '../components/skeletons'
import LoadFailure from '../components/LoadFailure'
import { loadStateOf } from '../lib/loadState'
import { SEO, CommonOgTags } from '../lib/seo'
import { storyOgImageUrl } from '../lib/api'
import { buildArticleSchema, buildBreadcrumbSchema, toJsonLd } from '../lib/structured-data'
import { FOCUS_RING, TEXT_LINK } from '../lib/control-classes'

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

/** The links under Related Stories: a 24px box each (WCAG 2.5.8), not underlined since they stand alone. */
const KEEP_READING_LINK = `inline-flex items-center min-h-6 text-brand-700 hover:text-brand-800 ${FOCUS_RING} rounded px-1`

// ---------------------------------------------------------------------------
// Analysis section with ruled heading + numbered points
// ---------------------------------------------------------------------------

function AnalysisSection({
  title,
  text,
  accentColor,
  numberColor,
  aiField,
}: {
  title: string
  text: string
  /** The heading's dot */
  accentColor: string
  /** The points' numbers: 24px bold, large text, so 3:1 is the bar; the 700 text shade clears it with room */
  numberColor: string
  /** API field name of the AI-generated text, for the machine-readable marker */
  aiField: string
}) {
  const points = parsePoints(text)

  return (
    <section className="mb-10" data-ai-generated={aiField}>
      {/* Ruled heading with colored dot — larger text. An h2 under the headline, like "Related Stories" */}
      <h2 className="ruled-heading mb-6 !text-sm !tracking-wider">
        <span className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: accentColor }} aria-hidden="true" />
          {title}
        </span>
      </h2>

      {/* Numbered points — fixed-width number column for alignment */}
      <div className="space-y-6">
        {points.map((point, idx) => (
          <div key={idx} className="flex gap-4">
            <span
              className="font-nexa text-2xl font-bold leading-none pt-1 select-none text-right"
              style={{ color: numberColor, width: '2ch' }}
              aria-hidden="true"
            >
              {idx + 1}
            </span>
            <div className="prose flex-1 min-w-0">
              <Markdown>{point}</Markdown>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Story page
// ---------------------------------------------------------------------------

export default function StoryPage() {
  const { slug } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const { openFeedback } = useFeedback()
  const storyQuery = usePublicStory(slug || '')
  const story = storyQuery.data
  // Never prerendered: the real states always show (lib/loadState.ts)
  const loadState = loadStateOf(storyQuery, false)
  // The issue and episode the story was in, for the cards at the end; by the address's slug, so also alongside the story
  const appearances = useStoryAppearances(slug).data

  // Redirect to primary story's URL if this slug was a non-primary cluster member
  useEffect(() => {
    if (story?.slug && slug && story.slug !== slug) {
      navigate(`/stories/${story.slug}`, { replace: true })
    }
  }, [story, slug, navigate])

  // Track reading history
  useEffect(() => {
    if (slug && story) markAsRead(slug)
  }, [slug, story])

  if (loadState === 'loading') {
    return <StoryPageSkeleton />
  }

  const backHome = (
    <Link to="/" className={`text-brand-700 hover:text-brand-800 font-normal ${FOCUS_RING} rounded px-1`}>
      &larr; Back to home
    </Link>
  )

  if (loadState === 'failed') {
    return (
      <LoadFailure title="This story couldn't load" query={storyQuery} className="page-section">
        {backHome}
      </LoadFailure>
    )
  }

  if (!story) {
    return (
      <div className="page-section text-center">
        {/* The address answers 200 (a removed story included), so the view itself keeps search engines away */}
        <Helmet>
          <meta name="robots" content="noindex" />
        </Helmet>
        <h1 className="page-title">Story Not Found</h1>
        <p className="text-neutral-500 mb-6">This story may have been removed or is not yet published.</p>
        {backHome}
      </div>
    )
  }

  const titleLabel = getTitleLabel(story)
  const headline = getHeadline(story)
  const displayTitle = titleLabel ? `${titleLabel}: ${headline}` : headline
  const hasSourceDate = !!story.sourceDatePublished
  const displayDate = story.datePublished || story.dateCrawled
  const dateStr = new Date(displayDate).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
  const sourceDateStr = story.sourceDatePublished
    ? new Date(story.sourceDatePublished).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : null

  // Previews and share text cannot render Markdown; the server builds the same description for crawlers
  const description = markdownToPlainText(story.summary ?? '') || displayTitle
  const shareDescription = markdownToPlainText(story.marketingBlurb ?? '') || description
  const issueSlug = story.issue?.slug ?? story.feed?.issue?.slug ?? 'general-news'
  const issueName = story.issue?.name ?? story.feed?.issue?.name ?? 'News'
  const colors = getCategoryColor(issueSlug)

  return (
    <>
      <Helmet>
        <title>
          {displayTitle} - {SEO.siteName}
        </title>
        <meta name="description" content={description.slice(0, 160)} />
        <meta name="author" content="RelevanceAI by Actually Relevant" />
        <meta property="og:title" content={displayTitle} />
        <meta property="og:description" content={description.slice(0, 200)} />
        <meta property="og:type" content="article" />
        <meta property="og:url" content={`${SEO.siteUrl}/stories/${story.slug}`} />
        <meta property="article:author" content="RelevanceAI by Actually Relevant" />
        {story.datePublished && <meta property="article:published_time" content={story.datePublished} />}
        {/* The story's own preview image; the server injects the same tags for crawlers (.context/seo.md) */}
        {CommonOgTags({ image: storyOgImageUrl(story.slug) })}
        <script type="application/ld+json">{toJsonLd(buildArticleSchema(story))}</script>
        <script type="application/ld+json">
          {toJsonLd(
            buildBreadcrumbSchema([{ name: 'Home', url: SEO.siteUrl }, { name: issueName, url: `${SEO.siteUrl}/issues/${issueSlug}` }, { name: displayTitle }]),
          )}
        </script>
      </Helmet>

      <article>
        {/* Article header with category accent */}
        <header className="border-b border-neutral-100 pb-8 mb-8">
          <div className="page-section !pb-0 !mb-0">
            {/* No issue link above the title (owner, 2026-11-03): the issue is linked at the end, "More in {issue}" */}
            {/* Title. data-ai-generated marks AI-written text by API field name (.context/ai-transparency.md). */}
            {titleLabel && (
              <span className="block text-xs font-bold uppercase tracking-widest text-neutral-500 mb-3" data-ai-generated="titleLabel">
                {titleLabel}
              </span>
            )}
            {/* Without an AI title the headline falls back to the source's own, which is not AI text */}
            <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-5 leading-tight" data-ai-generated={story.title ? 'title' : undefined}>
              {headline}
            </h1>

            {/* Metadata + share. The "|" separators are visual only (aria-hidden, or alt text '' on a phone's ::before), so screen readers don't read them out */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-neutral-500">
              <div className={META_TEXT_ROW}>
                <time dateTime={displayDate}>{dateStr}</time>
                <span className="text-neutral-300 max-md:hidden" aria-hidden="true">
                  |
                </span>
                <span className={`inline-flex items-center gap-1.5 ${PHONE_SEPARATOR}`}>
                  <FeedFavicon feedId={story.feed.id} />
                  <a
                    href={story.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`text-brand-700 hover:text-brand-800 ${FOCUS_RING} rounded px-0.5`}
                  >
                    {story.feed.displayTitle || story.feed.title}
                    <span className="sr-only"> (opens in new tab)</span>
                  </a>
                  {hasSourceDate && <>, {sourceDateStr}</>}
                </span>
                <span className="text-neutral-300 max-md:hidden" aria-hidden="true">
                  |
                </span>
                <a
                  href={story.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`text-brand-700 hover:text-brand-800 ${FOCUS_RING} rounded px-0.5 ${PHONE_SEPARATOR}`}
                >
                  Original article
                  <span className="sr-only"> (opens in new tab)</span>
                </a>
                <span className="text-neutral-300 max-md:hidden" aria-hidden="true">
                  |
                </span>
                {/* AI label as plain text, so it doesn't read as one more navigation link */}
                <span className={`inline-flex flex-wrap items-center gap-x-2 ${PHONE_SEPARATOR}`}>
                  {/* The badge is the label's only "AI"; screen readers hear it as the word, so the sentence reads the same aloud */}
                  <span>
                    {AI_DISCLOSURE_COPY.storyLabel.lead} <AiBadge accessibleName={AI_DISCLOSURE_COPY.badgeText} className="align-middle" />
                    {AI_DISCLOSURE_COPY.storyLabel.tail}
                  </span>
                  <Link to={AI_DISCLOSURE_COPY.howItWorksHref} className={TEXT_LINK}>
                    {AI_DISCLOSURE_COPY.howItWorksLinkText}
                  </Link>
                </span>
              </div>
              {story.slug && (
                <>
                  {/* Phones: the actions take a line of their own as 44px tap targets, the first icon
                      level with the text above, so no separator leads into them */}
                  <span className="text-neutral-300 max-md:hidden" aria-hidden="true">
                    |
                  </span>
                  <span className="inline-flex flex-wrap items-center gap-x-3 max-md:basis-full max-md:-ml-3.5 max-md:gap-x-0.5">
                    <BookmarkButton slug={story.slug} size="sm" placement="row" />
                    <span className="text-neutral-300 max-md:hidden" aria-hidden="true">
                      |
                    </span>
                    <span className="inline-flex flex-wrap items-center gap-0.5">
                      <ShareButtons url={`${SEO.siteUrl}/stories/${story.slug}`} title={displayTitle} description={shareDescription} />
                    </span>
                  </span>
                </>
              )}
            </div>

            {/* Also covered by — cluster sources */}
            {story.slug && <AlsoCoveredBy slug={story.slug} />}
          </div>
        </header>

        <div className="page-section !pt-0">
          {/* Summary */}
          {story.summary && (
            <section className="mb-10" data-ai-generated="summary">
              <div className="prose drop-cap" style={{ '--drop-cap-color': colors.hex } as React.CSSProperties}>
                <Markdown>{story.summary}</Markdown>
              </div>
            </section>
          )}

          {/* Key quote — editorial pull-quote style */}
          {story.quote && (
            <div className="py-6 md:py-8 text-center max-w-2xl mx-auto mb-10" data-ai-generated="quote quoteAttribution">
              <div className="relative">
                <span
                  aria-hidden="true"
                  className="block text-brand-200 leading-none select-none pointer-events-none"
                  style={{ fontSize: '6rem', fontFamily: 'Georgia, "Times New Roman", serif' }}
                >
                  &ldquo;
                </span>
                <blockquote className="-mt-8">
                  {/* No italic — avoids loading Roboto-Italic; decorative quotes provide visual distinction */}
                  <p className="text-xl md:text-2xl text-neutral-700 leading-relaxed px-4">{story.quote}</p>
                </blockquote>
                <p className="text-sm text-neutral-500 mt-3">{quoteAttributionLine(story.quoteAttribution)}</p>
              </div>
            </div>
          )}

          {/* Why This Matters */}
          {story.relevanceReasons && (
            <AnalysisSection
              title="Why This Matters"
              text={story.relevanceReasons}
              accentColor={colors.hex}
              numberColor={colors.textHex}
              aiField="relevanceReasons"
            />
          )}

          {/* Caveats: a shade darker than "Why This Matters" */}
          {story.antifactors && (
            <AnalysisSection
              title="Caveats"
              text={story.antifactors}
              accentColor={shiftHex(colors.hex, -0.25)}
              numberColor={shiftHex(colors.textHex, -0.25)}
              aiField="antifactors"
            />
          )}

          {/* Report an error: a note on the analysis above, so it sits right under it, small and to the side */}
          <p className="text-sm text-neutral-600 text-right">
            Spotted a mistake?{' '}
            <button type="button" onClick={() => openFeedback({ id: story.id, title: displayTitle })} className={TEXT_LINK}>
              Report an error
            </button>
          </p>

          {/* The issue and episode this story was in */}
          <StoryAppearances appearances={appearances} className="mt-6" />

          {/* Keep reading: related stories, then the topic and a search for similar ones */}
          {story.slug && <RelatedStories slug={story.slug} />}
          <div className="mt-6 flex flex-wrap justify-center gap-x-8 gap-y-2 text-sm">
            <Link to={`/issues/${issueSlug}`} className={KEEP_READING_LINK}>
              More in {issueName} &rarr;
            </Link>
            <Link to={`/search?q=${encodeURIComponent(headline)}`} className={KEEP_READING_LINK}>
              Find similar stories &rarr;
            </Link>
          </div>

          {/* Where the reader finishes: the two weekly products */}
          <StoryProductButtons className="mt-12" />
        </div>
      </article>
    </>
  )
}

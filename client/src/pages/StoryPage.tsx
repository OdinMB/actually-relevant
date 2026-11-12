import { useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import { usePublicStory, useStoryAppearances } from '../hooks/usePublicStories'
import { getCategoryColor } from '../lib/category-colors'
import { markdownToPlainText } from '../lib/plainText'
import { getTitleLabel, getHeadline } from '../lib/title-label'
import { markAsRead } from '../lib/reading-history'
import BookmarkButton from '../components/BookmarkButton'
import ShareButtons from '../components/ShareButtons'
import { useFeedback } from '../components/FeedbackProvider'
import { StoryProductButtons } from '../components/CrossLinks'
import StoryAppearances from '../components/StoryAppearances'
import RelatedStories from '../components/RelatedStories'
import AlsoCoveredBy from '../components/AlsoCoveredBy'
import { MetaSeparator, StoryMetaRow } from '../components/story/StoryMetaRow'
import { StoryBody } from '../components/story/StoryBody'
import { StoryPageSkeleton } from '../components/skeletons'
import LoadFailure from '../components/LoadFailure'
import { loadStateOf } from '../lib/loadState'
import { SEO, CommonOgTags } from '../lib/seo'
import { storyOgImageUrl } from '../lib/api'
import { buildArticleSchema, buildBreadcrumbSchema, toJsonLd } from '../lib/structured-data'
import { FOCUS_RING, TEXT_LINK } from '../lib/control-classes'

/** The links under Related Stories: a 24px box each (WCAG 2.5.8), not underlined since they stand alone. */
const KEEP_READING_LINK = `inline-flex items-center min-h-6 text-brand-700 hover:text-brand-800 ${FOCUS_RING} rounded px-1`

/**
 * A story's page: the header (headline, metadata row with the actions, "Also covered by"), the
 * body, and where the reader goes next. The single-source and researched formats differ only in
 * `StoryMetaRow` and `StoryBody`, and in which of "Also covered by" and the Sources list shows.
 */
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

  // Previews and share text cannot render Markdown; the server builds the same description for crawlers
  const description = markdownToPlainText(story.summary ?? '') || displayTitle
  const shareDescription = markdownToPlainText(story.marketingBlurb ?? '') || description
  const issueSlug = story.issue?.slug ?? story.feed?.issue?.slug ?? 'general-news'
  const issueName = story.issue?.name ?? story.feed?.issue?.name ?? 'News'
  const colors = getCategoryColor(issueSlug)
  // The cited version, when the story has one and it could be served; the label keys on `researched` instead
  const research = story.research ?? null

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
              <StoryMetaRow story={story} research={research} />
              {story.slug && (
                <>
                  {/* Phones: the actions take a line of their own as 44px tap targets, the first icon
                      level with the text above, so no separator leads into them */}
                  <MetaSeparator />
                  <span className="inline-flex flex-wrap items-center gap-x-3 max-md:basis-full max-md:-ml-3.5 max-md:gap-x-0.5">
                    <BookmarkButton slug={story.slug} size="sm" placement="row" />
                    <MetaSeparator />
                    <span className="inline-flex flex-wrap items-center gap-0.5">
                      <ShareButtons url={`${SEO.siteUrl}/stories/${story.slug}`} title={displayTitle} description={shareDescription} />
                    </span>
                  </span>
                </>
              )}
            </div>

            {/* Also covered by — cluster sources; a researched story's Sources list takes it over */}
            {story.slug && !research && <AlsoCoveredBy slug={story.slug} />}
          </div>
        </header>

        <div className="page-section !pt-0">
          <StoryBody story={story} research={research} colors={colors} />

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

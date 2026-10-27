import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import Markdown, { type Components } from 'react-markdown'
import type { PublicNewsletterIssue } from '@shared/types'
import { SEO, CommonOgTags } from '../lib/seo'
import { buildBreadcrumbSchema } from '../lib/structured-data'
import { formatEpisodeDate } from '../lib/podcast'
import StructuredData from '../components/StructuredData'
import StoryTitleLabel from '../components/StoryTitleLabel'
import AiBadge from '../components/ai/AiBadge'
import { PodcastCrossLink } from '../components/CrossLinks'
import { NewsletterIssueSkeleton } from '../components/skeletons'
import LoadFailure from '../components/LoadFailure'
import { loadStateOf } from '../lib/loadState'
import { useNewsletterIssue } from '../hooks/useNewsletterArchive'
import { usePublicIssues } from '../hooks/usePublicIssues'
import { NEWSLETTER_FEED_URL, type PublicIssue } from '../lib/api'
import { getCategoryColor } from '../lib/category-colors'
import { ISSUE_CARD_CLASS, ISSUE_PAGE_CLASS, parseQuote, sectionSlug } from '../lib/newsletter-issue'
import { BRAND } from '../config'

const LINK_CLASS = 'text-brand-700 hover:text-brand-800 focus-visible:ring-2 focus-visible:ring-brand-500 rounded px-0.5'

/** A link inside the issue's text is underlined: its color alone barely stands out from the text around it. */
const INLINE_LINK_CLASS = `${LINK_CLASS} underline underline-offset-2`

/** The email's four-color strip under the logo: the four categories' colors, in home page order. */
const STRIP_CATEGORIES = ['human-development', 'planet-climate', 'existential-threats', 'science-technology']

type IssueStory = PublicNewsletterIssue['stories'][number]

/** Plain text of a hast node (what a Markdown heading says). */
function textOf(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const n = node as { type?: string; value?: string; children?: unknown[] }
  if (n.type === 'text') return n.value ?? ''
  return (n.children ?? []).map(textOf).join('')
}

/** A story's publisher line ("Publisher · original article · relevance analysis"): a paragraph linking "original article". */
function isMetaLine(node: unknown): boolean {
  const children = (node as { children?: { type?: string; tagName?: string }[] } | undefined)?.children ?? []
  return children.some(child => child.type === 'element' && child.tagName === 'a' && textOf(child).trim() === 'original article')
}

/** A `# ` section heading as in the email: short rule, the category's colored dot, its name in capitals, short rule. */
function SectionHeading({ slug, children }: { slug: string; children: ReactNode }) {
  const colors = getCategoryColor(slug)
  return (
    <h2 className="mt-12 mb-1 flex items-center justify-center gap-3 text-center text-sm font-bold uppercase tracking-widest text-neutral-700 md:text-base">
      <span className="w-6 shrink-0 border-t border-neutral-200 sm:w-10" aria-hidden="true" />
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${colors.dotBg}`} aria-hidden="true" />
      <span>{children}</span>
      <span className="w-6 shrink-0 border-t border-neutral-200 sm:w-10" aria-hidden="true" />
    </h2>
  )
}

/** A quote as in the email: the words in italics, the attribution under them after an em dash. */
function IssueQuote({ node, children }: { node: unknown; children: ReactNode }) {
  const parsed = parseQuote(textOf(node))
  return (
    <blockquote className="mb-4 border-l-2 border-neutral-200 pl-4">
      {parsed ? (
        <>
          <p className="italic leading-relaxed text-neutral-700">&ldquo;{parsed.quote}&rdquo;</p>
          <p className="mt-1 text-sm text-neutral-600">&mdash; {parsed.attribution}</p>
        </>
      ) : (
        <div className="italic text-neutral-700">{children}</div>
      )}
    </blockquote>
  )
}

/** A site link in the stored issue (absolute, as in the email) becomes an in-app link. */
function IssueLink({ href = '', children }: { href?: string; children?: ReactNode }) {
  if (href.startsWith(`${SEO.siteUrl}/`)) {
    return (
      <Link to={href.slice(SEO.siteUrl.length)} className={INLINE_LINK_CLASS}>
        {children}
      </Link>
    )
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={INLINE_LINK_CLASS}>
      {children}
    </a>
  )
}

/**
 * How the stored Markdown renders on the web, styled like the email: `#` issue sections as ruled
 * headings with their category's dot, each `##` story heading with the "AI" badge and title label
 * above it (StoryTitleLabel) and linked to the story page, the publisher line in small type,
 * quotes with their attribution under them, links to the site kept in the app. The `---` between
 * sections draws nothing: the ruled headings already part them, as in the email.
 */
function issueComponents(stories: IssueStory[], categories: PublicIssue[] | undefined): Components {
  const byHeadline = new Map(stories.map(story => [story.headline.trim(), story]))
  return {
    h1: ({ node, children }) => <SectionHeading slug={sectionSlug(textOf(node), categories)}>{children}</SectionHeading>,
    h2: ({ node, children }) => {
      const story = byHeadline.get(textOf(node).trim())
      return (
        <div className="mt-8 mb-1.5">
          <StoryTitleLabel story={story ?? { titleLabel: null, title: null, sourceTitle: '' }} className="mb-1.5" />
          <h3 className="text-xl font-bold leading-snug text-neutral-900">
            {story?.slug ? (
              <Link to={`/stories/${story.slug}`} className="rounded transition-colors hover:text-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500">
                {children}
              </Link>
            ) : (
              children
            )}
          </h3>
        </div>
      )
    },
    a: ({ href, children }) => <IssueLink href={href}>{children}</IssueLink>,
    hr: () => null,
    p: ({ node, children }) =>
      isMetaLine(node) ? (
        <p className="mb-3 text-sm leading-normal text-neutral-600">{children}</p>
      ) : (
        <p className="mb-4 leading-relaxed text-neutral-700">{children}</p>
      ),
    blockquote: ({ node, children }) => <IssueQuote node={node}>{children}</IssueQuote>,
  }
}

/**
 * The email's masthead: the logo with the claim under it, then the four-color strip across the
 * card. Not on phones, where the site header right above already shows all three.
 */
function Masthead() {
  return (
    <div className="hidden sm:block">
      <div className="px-10 pt-10 text-center">
        <picture>
          <source srcSet="/images/optimized/logo-text-horizontal-small-h.webp" type="image/webp" />
          {/* Decorative: the site header above names the site */}
          <img src="/images/logo-text-horizontal.png" alt="" width={500} height={200} className="mx-auto h-16 w-auto" />
        </picture>
        <p className="text-[15px] italic text-neutral-500">{BRAND.claim.replace(/\.$/, '')}</p>
      </div>
      <div className="mt-5 flex h-1" aria-hidden="true">
        {STRIP_CATEGORIES.map(slug => (
          <span key={slug} className={`flex-1 ${getCategoryColor(slug).dotBg}`} />
        ))}
      </div>
    </div>
  )
}

function IssueHead({ issue }: { issue: PublicNewsletterIssue }) {
  const url = `${SEO.siteUrl}/newsletter/${issue.slug}`
  const title = `${issue.title} - Actually Relevant Newsletter`
  const description = `${issue.title} of the Actually Relevant weekly newsletter: the stories that matter to humanity this week, to read on the web.`
  return (
    <>
      <Helmet>
        <title>{title}</title>
        <meta name="description" content={description.slice(0, 160)} />
        <link rel="canonical" href={url} />
        <link rel="alternate" type="application/rss+xml" title="Actually Relevant newsletter" href={NEWSLETTER_FEED_URL} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description.slice(0, 200)} />
        <meta property="og:type" content="article" />
        <meta property="og:url" content={url} />
        <meta property="article:published_time" content={issue.publishedAt} />
        {CommonOgTags({})}
      </Helmet>
      <StructuredData
        data={buildBreadcrumbSchema([{ name: 'Home', url: SEO.siteUrl }, { name: 'Newsletter', url: `${SEO.siteUrl}/newsletter` }, { name: issue.title }])}
      />
    </>
  )
}

function BackToArchive() {
  return (
    <Link to="/newsletter" className={LINK_CLASS}>
      &larr; All issues
    </Link>
  )
}

function NotFound() {
  return (
    <div className="page-section text-center">
      <Helmet>
        <meta name="robots" content="noindex" />
      </Helmet>
      <h1 className="page-title">Issue Not Found</h1>
      <p className="text-neutral-500 mb-6">This issue may have been taken down or is not yet published.</p>
      <BackToArchive />
    </div>
  )
}

/**
 * One published issue's web edition (`/newsletter/:slug`), dressed like the email: a white card
 * on a tinted page (edge to edge on phones) with the logo, claim and four-color strip, the title
 * and date, the issue's AI label (the same wording as at the top of the email) before any AI
 * text, then the stored issue text. Loads client-side like a story page; not prerendered, listed
 * in the server sitemap.
 */
export default function NewsletterIssuePage() {
  const { slug = '' } = useParams<{ slug: string }>()
  const issueQuery = useNewsletterIssue(slug)
  const issue = issueQuery.data
  // The site's categories, to color each section's dot; sectionSlug() manages without them
  const { data: categories } = usePublicIssues()
  // Never prerendered: an automated browser still sees the not-found view and its noindex (lib/loadState.ts)
  const loadState = loadStateOf(issueQuery, false)

  if (loadState === 'loading') return <NewsletterIssueSkeleton />
  if (loadState === 'failed')
    return (
      <LoadFailure title="This issue couldn't load" query={issueQuery} className="page-section">
        <BackToArchive />
      </LoadFailure>
    )
  if (!issue) return <NotFound />

  return (
    <>
      <IssueHead issue={issue} />
      <div className={ISSUE_PAGE_CLASS}>
        <article className={ISSUE_CARD_CLASS}>
          <Masthead />
          <div className="px-5 pt-8 text-center sm:px-10 sm:pt-6">
            <h1 className="text-base font-bold uppercase tracking-widest text-neutral-800 md:text-lg">{issue.title}</h1>
            <p className="mt-1 text-sm text-neutral-600">
              <time dateTime={issue.publishedAt}>{formatEpisodeDate(issue.publishedAt)}</time>
            </p>
            <p className="mx-auto mt-4 max-w-md text-sm leading-normal text-neutral-700" data-newsletter-ai-label>
              <AiBadge decorative className="mr-2 align-middle" />
              <strong>{issue.aiLabel.lead}</strong> {issue.aiLabel.text}
            </p>
          </div>

          <div className="px-5 pt-2 pb-10 sm:px-10" data-ai-generated="content">
            <Markdown components={issueComponents(issue.stories, categories)}>{issue.content}</Markdown>
          </div>

          <footer className="border-t border-neutral-200 bg-neutral-50 px-5 py-6 sm:px-10">
            <div className="flex flex-wrap justify-between gap-4">
              <BackToArchive />
              <Link to="/newsletter" className={LINK_CLASS}>
                Get the newsletter by email
              </Link>
            </div>
            <PodcastCrossLink className="mt-4" />
          </footer>
        </article>
      </div>
    </>
  )
}

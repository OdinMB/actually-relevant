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
import { NewsletterIssueSkeleton } from '../components/skeletons'
import { useNewsletterIssue } from '../hooks/useNewsletterArchive'

const LINK_CLASS = 'text-brand-700 hover:text-brand-800 focus-visible:ring-2 focus-visible:ring-brand-500 rounded px-0.5'

type IssueStory = PublicNewsletterIssue['stories'][number]

/** Plain text of a hast node (what a Markdown heading says). */
function textOf(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const n = node as { type?: string; value?: string; children?: unknown[] }
  if (n.type === 'text') return n.value ?? ''
  return (n.children ?? []).map(textOf).join('')
}

/** A site link in the stored issue (absolute, as in the email) becomes an in-app link. */
function IssueLink({ href = '', children }: { href?: string; children?: ReactNode }) {
  if (href.startsWith(`${SEO.siteUrl}/`)) {
    return <Link to={href.slice(SEO.siteUrl.length)} className={LINK_CLASS}>{children}</Link>
  }
  return <a href={href} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>{children}</a>
}

/**
 * How the stored Markdown renders on the web: `#` issue sections as section headings, each `##`
 * story heading with the "AI" badge and title label above it (StoryTitleLabel) and linked to the
 * story page, links to the site kept in the app.
 */
function issueComponents(stories: IssueStory[]): Components {
  const byHeadline = new Map(stories.map((story) => [story.headline.trim(), story]))
  return {
    h1: ({ children }) => <h2 className="section-heading mt-12 mb-6">{children}</h2>,
    h2: ({ node, children }) => {
      const story = byHeadline.get(textOf(node).trim())
      return (
        <div className="mt-8 mb-2">
          <StoryTitleLabel story={story ?? { titleLabel: null, title: null, sourceTitle: '' }} className="mb-2" />
          <h3 className="text-xl font-bold leading-snug text-neutral-900">
            {story?.slug ? <Link to={`/stories/${story.slug}`} className={LINK_CLASS}>{children}</Link> : children}
          </h3>
        </div>
      )
    },
    a: ({ href, children }) => <IssueLink href={href}>{children}</IssueLink>,
    hr: () => <hr className="my-10 border-neutral-200" />,
    p: ({ children }) => <p className="mb-4 text-neutral-700 leading-relaxed">{children}</p>,
    blockquote: ({ children }) => (
      <blockquote className="mb-4 border-l-4 border-neutral-200 pl-4 italic text-neutral-700">{children}</blockquote>
    ),
  }
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
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description.slice(0, 200)} />
        <meta property="og:type" content="article" />
        <meta property="og:url" content={url} />
        <meta property="article:published_time" content={issue.publishedAt} />
        {CommonOgTags({})}
      </Helmet>
      <StructuredData
        data={buildBreadcrumbSchema([
          { name: 'Home', url: SEO.siteUrl },
          { name: 'Newsletter', url: `${SEO.siteUrl}/newsletter` },
          { name: 'Archive', url: `${SEO.siteUrl}/newsletter/archive` },
          { name: issue.title },
        ])}
      />
    </>
  )
}

function BackToArchive() {
  return <Link to="/newsletter/archive" className={LINK_CLASS}>&larr; All issues</Link>
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
 * One published issue's web edition (`/newsletter/:slug`): title and date, the issue's AI label
 * (the same wording as at the top of the email) before any AI text, then the stored issue text.
 * Loads client-side like a story page; not prerendered, listed in the server sitemap.
 */
export default function NewsletterIssuePage() {
  const { slug = '' } = useParams<{ slug: string }>()
  const { data: issue, isLoading, isError } = useNewsletterIssue(slug)

  if (isLoading) return <NewsletterIssueSkeleton />
  if (isError || !issue) return <NotFound />

  return (
    <>
      <IssueHead issue={issue} />
      <article className="page-section py-16">
        <h1 className="page-title">{issue.title}</h1>
        <p className="text-sm text-neutral-600 text-center">
          <time dateTime={issue.publishedAt}>{formatEpisodeDate(issue.publishedAt)}</time>
        </p>
        <p className="mt-6 text-sm text-neutral-700 text-center" data-newsletter-ai-label>
          <AiBadge decorative className="mr-2 align-middle" />
          <strong>{issue.aiLabel.lead}</strong> {issue.aiLabel.text}
        </p>

        <div className="mt-10" data-ai-generated="content">
          <Markdown components={issueComponents(issue.stories)}>{issue.content}</Markdown>
        </div>

        <div className="border-t border-neutral-200 pt-6 mt-10 flex flex-wrap justify-between gap-4">
          <BackToArchive />
          <Link to="/newsletter" className={LINK_CLASS}>Get the newsletter by email</Link>
        </div>
      </article>
    </>
  )
}

import { ReactNode } from 'react'
import { Helmet } from 'react-helmet-async'
import { BRAND } from '../config'

// Shared SEO constants
export const SEO = {
  siteName: 'Actually Relevant',
  siteUrl: 'https://actuallyrelevant.news',
  defaultTitle: 'Actually Relevant - News That Matters to Humanity',
  defaultDescription: `${BRAND.claim} ${BRAND.claimSupport}`,
  ogImage: 'https://actuallyrelevant.news/images/og-image.png',
  ogImageWidth: '1200',
  ogImageHeight: '630',
  twitterCard: 'summary_large_image' as const,
}

/**
 * Common OG meta tags that should appear on every page.
 * Use inside <Helmet> after page-specific tags.
 * Returns an array (not fragment) for react-helmet-async compatibility.
 */
export function CommonOgTags({ image = SEO.ogImage }: { image?: string }): ReactNode {
  return [
    <meta key="og:site_name" property="og:site_name" content={SEO.siteName} />,
    <meta key="og:image" property="og:image" content={image} />,
    <meta key="og:image:width" property="og:image:width" content={SEO.ogImageWidth} />,
    <meta key="og:image:height" property="og:image:height" content={SEO.ogImageHeight} />,
    <meta key="twitter:card" name="twitter:card" content={SEO.twitterCard} />,
    <meta key="twitter:image" name="twitter:image" content={image} />,
  ]
}

/**
 * Site-wide fallback head tags, rendered once above all routes.
 *
 * Helmet lets the innermost instance win per meta name/property, so any page
 * that sets its own description, og:* or twitter:* tag replaces the matching
 * default here. The same tags in index.html carry `data-rh="true"`, which tells
 * Helmet it owns them: on its first commit it removes them and writes this
 * merged set, so each page (prerendered or navigated client-side) ends up with
 * exactly one of each.
 */
export function DefaultSeo(): ReactNode {
  return (
    <Helmet>
      <title>{SEO.defaultTitle}</title>
      <meta name="description" content={SEO.defaultDescription} />
      <meta property="og:type" content="website" />
      <meta property="og:title" content={SEO.defaultTitle} />
      <meta property="og:description" content={SEO.defaultDescription} />
      <meta property="og:url" content={`${SEO.siteUrl}/`} />
      <meta property="article:author" content={SEO.siteName} />
      {CommonOgTags({})}
    </Helmet>
  )
}

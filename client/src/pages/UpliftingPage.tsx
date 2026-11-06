import { Helmet } from 'react-helmet-async'
import { BRAND } from '../config'
import { SEO, CommonOgTags } from '../lib/seo'
import { UPLIFTING_PATH, useUpliftingEdition } from '../contexts/PositivityContext'
import { HomeStories } from './HomePage'

const META = {
  title: `${BRAND.upliftingEdition} - Only Uplifting News from Actually Relevant`,
  description: `${BRAND.upliftingEdition}: only the stories AI tagged uplifting from Actually Relevant’s daily selection of news that matters to humanity. New ones as they arrive.`,
  url: `${SEO.siteUrl}${UPLIFTING_PATH}`,
}

/**
 * The Actually Uplifting edition's landing page, the link pitches and listings use. Its path puts
 * the dial at "Only uplifting" (PositivityProvider), so even its prerendered HTML is the edition:
 * the homepage feed, under a visually hidden h1 naming the edition for search engines and screen
 * readers. What the edition is, the row under the logo bar says, and its info dialog. If the reader
 * moves the dial off the far end here, the h1 goes and the feed's hero headline is the h1 again:
 * the page never claims "only uplifting" over another mix, and the reader stays put with focus on
 * the slider.
 */
export default function UpliftingPage() {
  const inEdition = useUpliftingEdition()

  return (
    <>
      <Helmet>
        <title>{META.title}</title>
        <meta name="description" content={META.description} />
        <link rel="canonical" href={META.url} />
        <meta property="og:title" content={META.title} />
        <meta property="og:description" content={META.description} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={META.url} />
        {CommonOgTags({})}
      </Helmet>

      {inEdition && <h1 className="sr-only">{BRAND.upliftingEdition}</h1>}
      <HomeStories headingLevel={inEdition ? 2 : 1} />
    </>
  )
}

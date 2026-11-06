import { Helmet } from 'react-helmet-async'
import { Link, useSearchParams } from 'react-router-dom'
import { BRAND } from '../config'
import { SEO, CommonOgTags } from '../lib/seo'
import { TEXT_LINK } from '../lib/control-classes'
import { UPLIFTING_PATH, useUpliftingEdition, withMix } from '../contexts/PositivityContext'
import { HomeStories } from './HomePage'

const META = {
  title: `${BRAND.upliftingEdition} - Only Uplifting News from Actually Relevant`,
  description: `${BRAND.upliftingEdition}: only the stories AI tagged uplifting from Actually Relevant’s daily selection of news that matters to humanity. New ones as they arrive.`,
  url: `${SEO.siteUrl}${UPLIFTING_PATH}`,
}

/** What the edition is, that AI tags the tone, and the way back to the full picture. */
function UpliftingIntro() {
  const [searchParams] = useSearchParams()

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 md:py-12 text-center">
      <h1 className="text-3xl md:text-4xl font-bold text-neutral-900 mb-4">{BRAND.upliftingEdition}</h1>
      <p className="text-lg text-neutral-600 leading-relaxed">
        Only the uplifting stories from Actually Relevant&rsquo;s daily selection of news that matters to humanity. AI tags each story&rsquo;s tone; Actually
        Uplifting shows the ones tagged uplifting.
      </p>
      <p className="mt-3 text-neutral-600 leading-relaxed">
        Fewer stories make the cut, so this page changes more slowly. For the full picture,{' '}
        <Link to={`/?${withMix(searchParams, 50)}`} className={TEXT_LINK}>
          see all news
        </Link>
        .
      </p>
    </div>
  )
}

/**
 * The Actually Uplifting edition's landing page, the link pitches and listings use. Its path puts
 * the dial at "Only uplifting" (PositivityProvider), so even its prerendered HTML is the edition:
 * the intro, holding the page's h1, above the homepage feed. If the reader moves the dial off the
 * far end here, the intro goes and the feed's hero headline is the h1 again: the page never claims
 * "only uplifting" over another mix, and the reader stays put with focus on the slider.
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

      {inEdition && <UpliftingIntro />}
      <HomeStories headingLevel={inEdition ? 2 : 1} />
    </>
  )
}

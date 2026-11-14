import { Helmet } from 'react-helmet-async'
import { Link } from 'react-router-dom'
import { Disclosure, DisclosureButton, DisclosurePanel } from '@headlessui/react'
import { SEO, CommonOgTags } from '../lib/seo'
import { buildBreadcrumbSchema } from '../lib/structured-data'
import StructuredData from '../components/StructuredData'
import LandingCta from '../components/LandingCta'
import ChevronIcon from '../components/icons/ChevronIcon'
import { AI_DISCLOSURE_COPY } from '../components/ai/aiDisclosureCopy'
import { useSources } from '../hooks/useSources'
import { getCategoryColor } from '../lib/category-colors'

const META = {
  title: 'Our Methodology \u2014 How AI Curates the News | Actually Relevant',
  description:
    'Curated global sources, a multi-stage AI pipeline, and full transparency. Learn exactly how Actually Relevant selects the stories that matter most to humanity.',
  url: `${SEO.siteUrl}/methodology`,
}

const techArticleSchema = {
  '@context': 'https://schema.org',
  '@type': 'TechArticle',
  headline: 'Our Methodology \u2014 How AI Curates the News',
  description: "Detailed explanation of Actually Relevant's multi-stage AI news curation pipeline, covering curated sources in multiple languages.",
  url: META.url,
  author: {
    '@type': 'Organization',
    name: 'Actually Relevant',
    url: SEO.siteUrl,
  },
  about: [
    { '@type': 'Thing', name: 'AI news curation' },
    { '@type': 'Thing', name: 'Algorithmic transparency' },
    { '@type': 'Thing', name: 'News aggregation methodology' },
  ],
}

const breadcrumb = buildBreadcrumbSchema([
  { name: 'Home', url: SEO.siteUrl },
  { name: 'Methodology', url: META.url },
])

export default function MethodologyPage() {
  const { data: sources, isLoading: sourcesLoading } = useSources()
  return (
    <>
      <Helmet>
        <title>{META.title}</title>
        <meta name="description" content={META.description} />
        <meta property="og:title" content={META.title} />
        <meta property="og:description" content={META.description} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={META.url} />
        {CommonOgTags({})}
      </Helmet>
      <StructuredData data={[techArticleSchema, breadcrumb]} />

      <div className="page-section">
        <h1 className="page-title">Our Methodology</h1>
        <div className="prose max-w-none">
          <h2 className="section-heading mt-8">What Does "Relevant" Mean?</h2>
          <p>
            We only feature stories that are important for humanity and its long-term future. Most daily news focuses on events that are dramatic, local, or
            short-lived. We filter for stories that affect large numbers of people, shift long-term trends, or represent genuine progress in our understanding
            of the world.
          </p>

          <h2 className="section-heading mt-8">Our Process</h2>
          <p>We use AI to find the most relevant news for you:</p>

          {/* Process funnel */}
          <div className="my-6">
            {/* Legend */}
            <div className="flex items-center gap-1.5 justify-end mb-4 text-xs text-neutral-500">
              <span className="w-2.5 h-2.5 rounded-full bg-brand-500 shrink-0" aria-hidden="true" />
              <span>= story</span>
            </div>

            <div>
              {[
                {
                  label: 'Collection',
                  desc: sources
                    ? `We crawl ${sources.totalCount} curated news sources in multiple languages across four issue areas. Article content is extracted automatically using a three-tier system that handles different site formats.`
                    : 'We crawl curated news sources in multiple languages across four issue areas. Article content is extracted automatically using a three-tier system that handles different site formats.',
                  dots: 20,
                },
                {
                  label: 'Pre-screening',
                  desc: 'A large language model reads each article and makes a first-pass judgment: Does this story matter beyond its immediate context? Articles that don\u2019t meet the threshold are filtered out, along with duplicates of the same event.',
                  dots: 10,
                },
                {
                  label: 'Analysis',
                  desc: 'We identify the Issue area that a story belongs to, assess how relevant it is for humanity based on that Issue\u2019s criteria, give a rating, and generate a summary. Ratings consider factors like scale of impact, novelty, policy implications, and humanitarian significance.',
                  dots: 4,
                },
                {
                  label: 'Comparison',
                  desc: 'We compare stories against each other and select the most relevant ones for publication.',
                  dots: 2,
                },
                {
                  label: 'Newsletter curation',
                  desc: 'We identify the 8 most relevant stories of the week, 2 from each Issue.',
                  dots: 1,
                },
              ].map(step => (
                <div key={step.label} className="flex gap-4 md:gap-6 items-center py-3">
                  <div className="flex-1">
                    <strong className="text-neutral-800">{step.label}</strong>
                    <p className="text-sm text-neutral-500 mt-1 leading-relaxed">{step.desc}</p>
                  </div>
                  {/* Dot cluster — fewer stories = stronger color */}
                  <div className="w-16 md:w-20 shrink-0 flex flex-wrap justify-end gap-[5px]" role="img" aria-label={`~${step.dots} stories remaining`}>
                    {Array.from({ length: step.dots }).map((_, j) => (
                      <span
                        key={j}
                        className="w-2.5 h-2.5 rounded-full bg-brand-500"
                        style={{ opacity: 0.25 + 0.75 * (1 - step.dots / 20) }}
                        aria-hidden="true"
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <h2 className="section-heading mt-8">Issue Areas</h2>
          <p>We cover four main issue areas, each with adapted evaluation criteria. Some areas have subcategories with further adjusted criteria.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
          {[
            { slug: 'human-development', title: 'Human Development', description: 'Poverty, health, education, migration, human rights' },
            { slug: 'planet-climate', title: 'Planet & Climate', description: 'Climate change, biodiversity, ecosystems, energy' },
            { slug: 'existential-threats', title: 'Existential Threats', description: 'Nuclear weapons, pandemics, AI risks, conflict' },
            { slug: 'science-technology', title: 'Science & Technology', description: 'Research breakthroughs, innovation, AI policy' },
          ].map(card => {
            const colors = getCategoryColor(card.slug)
            return (
              <Link
                key={card.slug}
                to={`/issues/${card.slug}`}
                className="block bg-white border border-neutral-200 border-t-4 rounded-lg p-5 hover:shadow-md transition-shadow focus-visible:ring-2 focus-visible:ring-brand-500 no-underline"
                style={{ borderTopColor: colors.hex }}
              >
                <h3 className="font-bold text-neutral-800 mb-1">{card.title}</h3>
                <p className="text-sm text-neutral-600">{card.description}</p>
              </Link>
            )
          })}
        </div>
        <div className="prose max-w-none">
          {/* Our Sources */}
          <h2 className="section-heading mt-10">Our Sources</h2>
          <p>
            We monitor{sources ? ` ${sources.totalCount}` : ''} curated publications. Every source is chosen for editorial quality, regional coverage, or
            subject-matter expertise — not for traffic volume.
          </p>

          {sourcesLoading ? (
            <div className="space-y-3 mt-6">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-5 bg-neutral-100 rounded animate-pulse" />
              ))}
            </div>
          ) : sources ? (
            <div className="mt-6 space-y-2">
              <Disclosure as="div" className="border border-neutral-200 rounded-lg">
                <DisclosureButton className="flex w-full items-center justify-between px-5 py-4 text-left font-bold text-neutral-800 hover:bg-neutral-50 transition-colors rounded-lg focus-visible:ring-2 focus-visible:ring-brand-500">
                  By Region
                  <ChevronIcon className="w-5 h-5 text-neutral-400 data-[open]:rotate-180 transition-transform shrink-0" />
                </DisclosureButton>
                <DisclosurePanel className="px-5 pb-4 space-y-2">
                  {Object.entries(sources.byRegion).map(([region, names]) => (
                    <p key={region} className="text-sm">
                      <strong>{region}:</strong> {names.join(', ')}
                    </p>
                  ))}
                </DisclosurePanel>
              </Disclosure>

              <Disclosure as="div" className="border border-neutral-200 rounded-lg">
                <DisclosureButton className="flex w-full items-center justify-between px-5 py-4 text-left font-bold text-neutral-800 hover:bg-neutral-50 transition-colors rounded-lg focus-visible:ring-2 focus-visible:ring-brand-500">
                  By Issue Area
                  <ChevronIcon className="w-5 h-5 text-neutral-400 data-[open]:rotate-180 transition-transform shrink-0" />
                </DisclosureButton>
                <DisclosurePanel className="px-5 pb-4 space-y-2">
                  {Object.entries(sources.byIssue).map(([issue, names]) => (
                    <p key={issue} className="text-sm">
                      <strong>{issue}</strong> — {names.join(', ')}
                    </p>
                  ))}
                </DisclosurePanel>
              </Disclosure>
            </div>
          ) : null}

          <h3 className="mt-8 font-bold text-neutral-800">Publishers&apos; AI Opt-Outs</h3>
          <p>
            We only crawl publishers who haven&apos;t opted out of the kind of automated reading we do. We don&apos;t add a source, and we remove an existing
            one, if the publisher has made any of these general reservations: a text and data mining reservation under the TDMRep protocol, a content signal
            that rules out AI input, a robots.txt rule that blocks all crawlers or ours, or terms of use that forbid AI processing, summarizing, or text and
            data mining of its articles.
          </p>
          <p>
            Rules aimed only at training AI models don&apos;t cover what we do, and neither do robots.txt rules that block the crawlers of specific AI
            companies. We don&apos;t train AI models. Our crawler identifies itself as ActuallyRelevant and reads each article once, and every story links to
            the original. EU law allows text and data mining unless the rightsholder has reserved it in a machine-readable way (Article 4 of the Directive on
            Copyright in the Digital Single Market). We check these rules when we add a source and whenever we review our source list, and our crawler checks
            the machine-readable ones again before it reads each article.
          </p>
          <p>
            Some publishers, such as newsletters on Substack, don&apos;t allow their article pages to be fetched but publish each full article in their RSS
            feed. For those, we read the article from the feed and never fetch the page.
          </p>

          {/* Researched Stories (owner-approved wording, 2026-11-12; the own-words sentences approved 2026-11-13, the headline, summary and blurb check 2026-11-14); the label it quotes comes from the label copy */}
          <h2 id="researched-stories" className="section-heading mt-10 scroll-mt-20">
            Researched Stories
          </h2>
          <p>
            Before a selected story is published, AI researches it further. It searches the news for other reports of the same event, published from two weeks
            before to one week after the original article, and reads up to six sources, the original article included, plus our own earlier coverage. It skips
            any publisher that has opted out in a machine-readable way, by the same checks our crawler runs before it reads an article. From the facts these
            sources report, AI writes a short story in its own words, combining what the sources say rather than translating or following any one of them, and
            cites the sources it draws on at the end of each paragraph. Tap a citation to see each outlet, its date and a sentence from it that backs the
            paragraph, chosen by AI and possibly translated.
          </p>
          <p>
            Each paragraph and point is then checked against the sources it cites, and the headline, summary and blurb against everything the research found,
            first by code and then by a second AI check. Both checks also look for text that follows a source&apos;s wording too closely, in the headline and
            summary too, and the AI check catches close translations. A paragraph or point that fails is rewritten, up to twice, and removed if it still fails.
            A headline, summary or blurb that stays too close to a source&apos;s wording is written again from the paragraphs that passed. If the research shows
            that the story is old news or is contradicted by other reports, we don&apos;t publish it. If the story&apos;s main development can&apos;t be
            confirmed, or the research fails or would exceed our monthly research budget, we publish the single-source version instead. Researched stories carry
            the label &quot;
            {AI_DISCLOSURE_COPY.researchedStoryLabel.lead} AI{AI_DISCLOSURE_COPY.researchedStoryLabel.tail}&quot; and list all their sources at the end,
            starting with the article where we first found the story.
          </p>

          {/* What We Don't Do */}
          <h2 className="section-heading mt-10">What We Don't Do</h2>
          <ul className="list-disc pl-6 space-y-2 mt-3">
            <li>
              <strong>We don't personalize.</strong> Everyone sees the same stories. There's no filter bubble.
            </li>
            <li>
              <strong>We don't optimize for clicks.</strong> No engagement metrics influence selection.
            </li>
            <li>
              <strong>We don't do original reporting.</strong> Every story links to the original source article. Headlines, summaries, blurbs, relevance
              analyses, and social posts are generated by AI. AI also rates each story, selects the stories we publish, and sets the emotion tag behind the
              dial. Quotes are selected by AI and translated into English where needed. No editor reviews anything before it's published. Spotted AI content
              without a label, or a label that's wrong? Tell us on the{' '}
              <Link to="/feedback" className="text-brand-700 hover:text-brand-800 underline focus-visible:ring-2 focus-visible:ring-brand-500 rounded">
                feedback page
              </Link>
              .
            </li>
            <li>
              <strong>We don't sell data.</strong> No tracking, no analytics profiles, no ad targeting.
            </li>
          </ul>

          {/* The Positivity Slider */}
          <h2 className="section-heading mt-10">The Positivity Dial</h2>
          <p>
            Readers can adjust a 5-position positivity dial that filters stories by emotional tone. This doesn't change what we select — it lets you control how
            much difficult news you see in a given session. It's a tool for managing news fatigue, not an editorial filter.
          </p>
          <p className="mt-2">
            <Link to="/news-fatigue" className="text-brand-700 hover:text-brand-800 underline focus-visible:ring-2 focus-visible:ring-brand-500 rounded">
              Learn more about our approach to news fatigue{' '}
            </Link>
          </p>

          {/* Transparency */}
          <h2 className="section-heading mt-10">Transparency</h2>
          <p>
            For every published story, we show the AI-generated analysis: why the story matters, what factors contributed to its rating, and potential caveats.
            We believe readers deserve to understand not just <em>what</em> is relevant, but <em>why</em>.
          </p>
          <p className="mt-4">
            AI curation is only trustworthy if you can verify it. We name our sources, explain our pipeline, and publish an open API so anyone can inspect what
            we produce.
          </p>
          <p className="mt-2">
            <Link to="/compare" className="text-brand-700 hover:text-brand-800 underline focus-visible:ring-2 focus-visible:ring-brand-500 rounded">
              See how we compare to other aggregators{' '}
            </Link>
            {' | '}
            <Link to="/free-api" className="text-brand-700 hover:text-brand-800 underline focus-visible:ring-2 focus-visible:ring-brand-500 rounded">
              Explore the free API
            </Link>
          </p>
        </div>

        <LandingCta heading="See it in action." description="Visit actuallyrelevant.news to read today's curated stories — or subscribe to the newsletter." />
      </div>
    </>
  )
}

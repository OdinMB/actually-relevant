/**
 * Invented data the fixture API answers with: issues, stories, newsletter issues, podcast episodes
 * and sources. Every story, publisher and quote is made up; no real person appears. Shapes follow
 * what the server's public routes return (server/src/routes/public/), typed against the shared
 * types and the client's own API types, so `test/fixtures-types.test.mjs` fails when they drift.
 *
 * The visible AI wording (newsletter label, podcast lines) is imported from the server's copy
 * module rather than repeated here, so the pages show the approved wording.
 *
 * Dates are relative to the run's start, so "2 days ago" reads the same in every run.
 *
 * @typedef {import('../../../shared/types').PublicStory} PublicStory
 * @typedef {import('../../../shared/types').EmotionTag} EmotionTag
 * @typedef {import('../../../shared/types').PaginatedResponse<FixtureStory>} StoryPage
 * @typedef {import('../../../shared/types').PublicNewsletterIssue} PublicNewsletterIssue
 * @typedef {import('../../../shared/types').PublicNewsletterIssueSummary} PublicNewsletterIssueSummary
 * @typedef {import('../../../shared/types').PublicPodcastResponse} PublicPodcastResponse
 * @typedef {import('../../../shared/types').PublicPodcastEpisode} PublicPodcastEpisode
 * @typedef {import('../../../shared/types').PublicPodcastEpisodeDetail} PublicPodcastEpisodeDetail
 * @typedef {import('../../../client/src/lib/api').PublicIssue} PublicIssue
 * @typedef {import('../../../client/src/lib/api').HomepageData} HomepageData
 *
 * A story as the public API serves it (PUBLIC_STORY_SELECT in server/src/services/storySelect.ts),
 * with the AI marker every public story carries (server/src/lib/aiProvenance.ts).
 * @typedef {Pick<PublicStory,
 *   'id' | 'slug' | 'sourceUrl' | 'sourceTitle' | 'title' | 'titleLabel' | 'dateCrawled' | 'datePublished' | 'status' |
 *   'relevancePre' | 'relevance' | 'emotionTag' | 'summary' | 'quote' | 'quoteAttribution' | 'marketingBlurb' |
 *   'relevanceReasons' | 'relevanceSummary' | 'antifactors' | 'feed'>
 *   & { issue: { name: string, slug: string } | null, aiGenerated: { fields: string[], model: string, digitalSourceType: string } }} FixtureStory
 *
 * @typedef {{ [K in keyof HomepageData['storiesByIssue'][string]]: FixtureStory[] }} EmotionBuckets
 * @typedef {{ issues: PublicIssue[], storiesByIssue: Record<string, EmotionBuckets> }} FixtureHomepage
 * @typedef {{ byRegion: Record<string, string[]>, byIssue: Record<string, string[]>, totalCount: number }} FixtureSources
 */
import {
  NEWSLETTER_TOP_LABEL,
  PODCAST_EPISODE_AI_LINE,
  PODCAST_OPENER,
  PODCAST_SHOW_DESCRIPTION,
  PODCAST_SIGN_OFF,
} from '../../../server/src/lib/aiLabelCopy.ts'

const IPTC_TRAINED_ALGORITHMIC_MEDIA = 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia'
const AI_STORY_FIELDS = ['title', 'titleLabel', 'summary', 'quote', 'quoteAttribution', 'marketingBlurb', 'relevanceReasons', 'relevanceSummary', 'antifactors']

/** The site's real issue slugs, in homepage order (client/src/pages/HomePage.tsx). */
const ISSUE_SPECS = [
  {
    slug: 'human-development',
    name: 'Human Development',
    children: [
      ['health-medicine', 'Health & Medicine'],
      ['education', 'Education'],
    ],
  },
  {
    slug: 'planet-climate',
    name: 'Planet & Climate',
    children: [
      ['energy', 'Energy'],
      ['ecosystems', 'Ecosystems'],
    ],
  },
  {
    slug: 'existential-threats',
    name: 'Existential Threats',
    children: [
      ['biosecurity', 'Biosecurity'],
      ['emerging-technology-risk', 'Emerging Technology Risk'],
    ],
  },
  {
    slug: 'science-technology',
    name: 'Science & Technology',
    children: [
      ['medical-research', 'Medical Research'],
      ['open-science', 'Open Science'],
    ],
  },
]

/**
 * Invented publishers.
 * @type {{ id: string, title: string, displayTitle: string | null, issueSlug: string, region: string }[]}
 */
const FEEDS = [
  { id: 'fixture-feed-1', title: 'Harbor Ledger', displayTitle: null, issueSlug: 'human-development', region: 'Global' },
  { id: 'fixture-feed-2', title: 'Meridian Review', displayTitle: null, issueSlug: 'human-development', region: 'Sub-Saharan Africa' },
  { id: 'fixture-feed-3', title: 'Daily Lantern — World', displayTitle: 'Daily Lantern', issueSlug: 'planet-climate', region: 'Western Europe' },
  { id: 'fixture-feed-4', title: 'Northfield Courier', displayTitle: null, issueSlug: 'planet-climate', region: 'North America' },
  { id: 'fixture-feed-5', title: 'Civic Monitor', displayTitle: null, issueSlug: 'existential-threats', region: 'Global' },
  { id: 'fixture-feed-6', title: 'Coastline Times', displayTitle: null, issueSlug: 'existential-threats', region: 'South & Southeast Asia' },
  { id: 'fixture-feed-7', title: 'Open Science Wire', displayTitle: null, issueSlug: 'science-technology', region: 'Global' },
  { id: 'fixture-feed-8', title: 'Plainview Gazette', displayTitle: null, issueSlug: 'science-technology', region: 'Latin America' },
]

/**
 * The stories: [issue slug, child slug or null, feed id, emotion, relevance, hours ago, label,
 * title, original headline, summary, quote, quote attribution, blurb, reasons, antifactors, verdict].
 * @type {[string, string | null, string, EmotionTag, number, number, string, string, string, string, string | null, string | null, string, string[], string[], string][]}
 */
const STORY_SPECS = [
  [
    'human-development',
    'health-medicine',
    'fixture-feed-1',
    'uplifting',
    8,
    6,
    'Maternal health',
    'Midwife training cuts maternal deaths by a third across rural clinics',
    'Rural clinics report sharp fall in maternal deaths',
    'A three-year program that trained midwives in remote clinics coincided with a one-third drop in maternal deaths, according to a regional health survey. The training focused on bleeding after birth, the most common cause of death. Health officials plan to extend it to neighboring districts next year.',
    'Most of these deaths were preventable with skills we could teach in weeks.',
    'A program coordinator, quoted in the survey report',
    'A cheap training program, a one-third drop in maternal deaths.',
    [
      'Scale: Maternal deaths remain a leading cause of death for women in low-income regions.',
      'Evidence: The decline is measured across three years of survey data.',
      'Replicability: The training is cheap and other health systems can copy it.',
    ],
    ['Attribution: The survey cannot fully separate the training from other changes made at the same time.', 'Coverage: The results come from one region.'],
    'A large, measured drop in preventable deaths from a low-cost program.',
  ],
  [
    'human-development',
    'education',
    'fixture-feed-2',
    'uplifting',
    7,
    20,
    'School meals',
    'Free school lunches lift attendance in a pilot across 200 schools',
    'Lunch pilot keeps more children in class',
    'Attendance rose by eight percentage points in schools that served a free daily lunch, an evaluation of a two-year pilot found. The gains were largest among girls in their last years of primary school. The education ministry is weighing whether to fund the meals nationwide.',
    'Children come for the meal and stay for the lessons.',
    'A head teacher at one of the pilot schools',
    'One meal a day, eight points more attendance.',
    [
      'Scale: Hundreds of thousands of children could be covered if the program expands.',
      'Evidence: The pilot compared participating schools with similar schools nearby.',
    ],
    ['Cost: The national budget for the expansion is not yet agreed.'],
    'A tested, scalable way to keep children in school.',
  ],
  [
    'human-development',
    null,
    'fixture-feed-1',
    'calm',
    6,
    30,
    'Literacy',
    'Adult reading skills unchanged over a decade, national survey finds',
    'Survey shows no change in adult literacy',
    'A national survey repeated every five years found adult reading skills at the same level as ten years ago. Younger adults scored slightly higher, older adults slightly lower. The researchers call for more evening classes in rural areas.',
    null,
    null,
    'Ten years, no change in how well adults read.',
    [
      'Breadth: Reading skills shape employment and health across a whole population.',
      'Method: The survey uses the same test each round, so the results are comparable.',
    ],
    ['Novelty: A flat trend changes little in the short term.'],
    'Steady numbers on a basic skill that affects many lives.',
  ],
  [
    'human-development',
    'health-medicine',
    'fixture-feed-2',
    'frustrating',
    7,
    44,
    'Health funding',
    'Vaccine shipments stall as a funding gap leaves clinics short',
    'Clinics run low on vaccines after donor shortfall',
    'Several hundred clinics report running out of routine childhood vaccines after a funding gap delayed two shipments. Health workers say parents who are turned away often do not return. The donors involved expect the gap to close within three months.',
    'Every week without stock is a week of children we will not see again.',
    'A district nurse',
    'Empty fridges where vaccines should be.',
    ['Scale: Routine vaccines prevent several of the most common childhood deaths.', 'Urgency: The shortfall is happening now.'],
    ['Duration: The gap is expected to be temporary.'],
    'A short funding gap with lasting effects on child health.',
  ],
  [
    'human-development',
    null,
    'fixture-feed-1',
    'scary',
    8,
    60,
    'Outbreak',
    'Cholera cases rise in flood-hit districts as water systems fail',
    'Cholera spreads after floods damage water supply',
    'Health authorities recorded a sharp rise in cholera cases in districts where floods damaged pumping stations. Emergency teams are distributing water purification tablets and setting up treatment centers. Officials warn that more rain is forecast.',
    null,
    null,
    'Floods broke the water systems; cholera followed.',
    ['Severity: Cholera can kill within hours without treatment.', 'Spread: Damaged water systems put large populations at risk.'],
    ['Response: Treatment is cheap and effective when it arrives in time.'],
    'A fast-moving health emergency after a disaster.',
  ],
  [
    'planet-climate',
    'energy',
    'fixture-feed-3',
    'uplifting',
    8,
    4,
    'Renewables',
    'Solar and wind supply over half of a national grid’s power for a full year',
    'Renewables pass the halfway mark on the grid',
    'For the first time, solar and wind together produced more than half of a national grid’s electricity over a full calendar year. Coal use fell to its lowest level on record. Grid operators credit new battery storage for smoothing supply on still evenings.',
    'The question is no longer whether renewables can carry the grid, but how fast.',
    'A grid operator’s annual report',
    'More than half the grid, a whole year long.',
    ['Scale: Electricity is one of the largest sources of emissions.', 'Durability: A full year of data rules out a lucky season.'],
    ['Context: One country’s grid may not translate directly to others.'],
    'A durable milestone in cutting power-sector emissions.',
  ],
  [
    'planet-climate',
    'ecosystems',
    'fixture-feed-4',
    'uplifting',
    6,
    26,
    'Reforestation',
    'Replanted mangroves bring fish back to coastal villages',
    'Fish return after mangrove replanting',
    'Ten years after villagers replanted mangroves along a stretch of coast, fish catches have nearly doubled, a university study found. The forests also reduced storm damage to nearby homes. Neighboring communities have asked for seedlings.',
    null,
    null,
    'Mangroves back, fish back.',
    [
      'Co-benefits: The project helps livelihoods, storm protection and carbon storage at once.',
      'Evidence: The study measured catches before and after replanting.',
    ],
    ['Scale: The project covers one stretch of coast.'],
    'A local restoration effort with measured benefits.',
  ],
  [
    'planet-climate',
    null,
    'fixture-feed-3',
    'calm',
    5,
    50,
    'Emissions data',
    'Revised inventory shows industrial emissions flat for a third year',
    'Industrial emissions hold steady',
    'An updated national emissions inventory shows industrial emissions unchanged for the third year in a row. Higher output was offset by efficiency gains in cement and steel. The agency will publish sector-by-sector detail next month.',
    null,
    null,
    'Industry’s emissions, flat again.',
    ['Measurement: Reliable inventories are the basis for every climate policy.'],
    ['Novelty: A flat trend is neither a breakthrough nor a setback.'],
    'Useful data on a large source of emissions.',
  ],
  [
    'planet-climate',
    null,
    'fixture-feed-4',
    'frustrating',
    7,
    70,
    'Climate finance',
    'Adaptation pledges fall short of the sums promised two years ago',
    'Climate adaptation funding lags promises',
    'Money delivered for climate adaptation is less than half of what wealthy countries pledged two years ago, a review by an independent panel found. The shortfall is largest for flood defenses and drought-resistant farming. The panel calls for a public tracker of payments.',
    'Promises do not build sea walls.',
    'The independent review panel',
    'Pledged, then half delivered.',
    [
      'Scale: Adaptation funding protects millions of people from climate impacts.',
      'Accountability: The gap between pledges and payments affects trust in future agreements.',
    ],
    ['Measurement: Counting methods differ between donors.'],
    'A wide gap between pledges and money paid out.',
  ],
  [
    'planet-climate',
    'energy',
    'fixture-feed-3',
    'scary',
    9,
    12,
    'Heat',
    'Record heat pushes a regional power grid into rolling blackouts',
    'Heatwave forces power cuts',
    'Temperatures above 45°C pushed electricity demand past what a regional grid could supply, forcing rolling blackouts for three days. Hospitals ran on backup generators. Forecasters expect heatwaves of this kind to become more frequent.',
    null,
    null,
    'Too hot for the grid to keep up.',
    ['Severity: Extreme heat without power is dangerous for the old and the sick.', 'Trend: Such heatwaves are becoming more common.'],
    ['Duration: Power returned after three days.'],
    'A warning of how heat and fragile grids combine.',
  ],
  [
    'existential-threats',
    'biosecurity',
    'fixture-feed-5',
    'uplifting',
    7,
    16,
    'Biosecurity',
    'Gene synthesis companies agree on shared screening rules for DNA orders',
    'DNA providers adopt common screening standard',
    'A group of companies that make synthetic DNA agreed to screen every order against a shared list of dangerous sequences. Orders that match will be reviewed by a person before shipping. The rules take effect next quarter.',
    'A shared list makes it much harder to shop around.',
    'An industry consortium statement',
    'One screening list for the whole industry.',
    ['Prevention: Screening closes one route to misuse of biotechnology.', 'Coordination: A shared standard avoids gaps between companies.'],
    ['Enforcement: The agreement is voluntary.'],
    'A practical step against a low-probability, high-impact risk.',
  ],
  [
    'existential-threats',
    null,
    'fixture-feed-6',
    'calm',
    6,
    40,
    'Arms control',
    'Arms control talks resume with a narrow agenda on missile launch notices',
    'Arms talks restart after two-year pause',
    'Delegations met for the first time in two years to discuss notifying each other before missile tests. No agreement was reached, but both sides agreed to meet again. Analysts call the agenda modest but useful.',
    null,
    null,
    'Talks restart, small steps first.',
    ['Risk: Misread missile tests are a known path to escalation.'],
    ['Outcome: No agreement yet.'],
    'Modest progress on reducing the risk of miscalculation.',
  ],
  [
    'existential-threats',
    'emerging-technology-risk',
    'fixture-feed-5',
    'frustrating',
    8,
    55,
    'AI safety',
    'Safety testing of new AI models stays voluntary as rules stall',
    'AI testing rules delayed again',
    'A proposal to require safety testing before powerful AI models are released was delayed for a second time. Developers continue to test on a voluntary basis, with different methods. Researchers warn that results cannot be compared.',
    'Without shared tests, every lab grades its own homework.',
    'An AI evaluation researcher',
    'Testing stays optional.',
    ['Stakes: Widely used AI systems can cause harm at scale.', 'Governance: Comparable testing is a basis for oversight.'],
    ['Progress: Voluntary testing does happen.'],
    'A stalled effort on a fast-moving risk.',
  ],
  [
    'existential-threats',
    'biosecurity',
    'fixture-feed-6',
    'scary',
    9,
    8,
    'Pandemic risk',
    'Bird flu found in a new mammal species, raising surveillance concerns',
    'Avian flu detected in another mammal',
    'Veterinary authorities confirmed avian influenza in a mammal species not previously known to carry it. There is no sign of spread to humans. Scientists are sequencing samples to check for mutations that would make human infection easier.',
    null,
    null,
    'Another species, another chance to adapt.',
    ['Severity: A flu adapted to humans could cause a pandemic.', 'Signal: Spread into new mammals is a warning sign.'],
    ['Evidence: No human cases have been linked to this finding.'],
    'An early warning worth close monitoring.',
  ],
  [
    'existential-threats',
    null,
    'fixture-feed-5',
    'uplifting',
    6,
    80,
    'Planetary defense',
    'Sky survey has now mapped most large near-Earth asteroids',
    'Telescope survey charts large asteroids',
    'A sky survey has catalogued an estimated two-thirds of near-Earth asteroids larger than 140 meters. None of the objects found poses a risk this century. The survey team expects to reach 90 percent within a decade.',
    null,
    null,
    'Most of the big ones, found and harmless.',
    ['Prevention: Finding asteroids early is what makes deflection possible.'],
    ['Probability: Impacts of this size are very rare.'],
    'Steady progress on a rare but severe risk.',
  ],
  [
    'science-technology',
    'medical-research',
    'fixture-feed-7',
    'uplifting',
    8,
    10,
    'Malaria',
    'Low-cost malaria vaccine reaches a million children in its first year',
    'Malaria vaccine rollout hits one million',
    'A malaria vaccine priced at a few dollars a dose reached one million children in its first year of rollout. Early data from health centers show fewer severe cases among vaccinated children. Supply is expected to triple next year.',
    'This is the first year we have had something new to offer every family.',
    'A regional immunization manager',
    'A million children, a few dollars a dose.',
    ['Scale: Malaria kills hundreds of thousands of children each year.', 'Cost: A cheap vaccine can reach the poorest areas.'],
    ['Evidence: The early data are not yet from a controlled study.'],
    'A cheap tool against one of the deadliest diseases for children.',
  ],
  [
    'science-technology',
    'open-science',
    'fixture-feed-8',
    'calm',
    6,
    36,
    'Open data',
    'Research funders require open access to publicly funded studies',
    'Funders mandate open access',
    'A group of public research funders will require that studies they pay for be free to read on publication. The rule applies to grants awarded from next year. Publishers will be paid a fixed fee per article.',
    null,
    null,
    'Paid for by the public, free for the public.',
    ['Access: Free access helps researchers in poorer countries.'],
    ['Impact: The effect on research quality is indirect.'],
    'A structural change in who can read research.',
  ],
  [
    'science-technology',
    null,
    'fixture-feed-7',
    'uplifting',
    7,
    65,
    'Batteries',
    'Sodium batteries enter mass production, easing pressure on lithium',
    'Sodium-ion cells go into volume production',
    'A battery maker began mass production of sodium-ion cells, which use abundant materials instead of lithium. The cells store less energy by weight but cost less and work better in the cold. The first customers are grid storage projects.',
    null,
    null,
    'Batteries from salt, not scarce metals.',
    ['Supply: Cheaper storage speeds the switch to renewable power.'],
    ['Performance: Sodium cells are heavier for the same energy.'],
    'A material shift that could make storage cheaper.',
  ],
  [
    'science-technology',
    'medical-research',
    'fixture-feed-8',
    'frustrating',
    6,
    90,
    'Antibiotics',
    'The pipeline of new antibiotics thins as developers leave the market',
    'Fewer new antibiotics in development',
    'The number of antibiotics in clinical trials fell for the third year in a row, a review of drug pipelines found. Several small developers closed after their drugs earned too little to cover costs. Health agencies are discussing paying developers up front.',
    'We are running out of options faster than we are finding them.',
    'An infectious disease specialist',
    'Fewer new drugs as resistance grows.',
    ['Scale: Drug-resistant infections already cause many deaths each year.', 'Trend: The decline has lasted three years.'],
    ['Response: New payment models are being discussed.'],
    'A worrying trend for a growing health threat.',
  ],
  [
    'science-technology',
    null,
    'fixture-feed-7',
    'scary',
    7,
    28,
    'Cybersecurity',
    'Ransomware attack shuts hospital systems for a week',
    'Hospital network hit by ransomware',
    'A ransomware attack forced a hospital network to switch to paper records for a week. Planned operations were postponed and ambulances diverted to other hospitals. Investigators have not said who was behind it.',
    null,
    null,
    'A week on paper after an attack.',
    ['Severity: Attacks on hospitals put patients at direct risk.'],
    ['Scope: One hospital network was affected.'],
    'A reminder of how vulnerable critical services are.',
  ],
]

/**
 * Readable fixture slug from a title.
 * @param {string} text
 */
function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}

/** @param {string} slug */
function issueSpec(slug) {
  return ISSUE_SPECS.find(spec => spec.slug === slug)
}

/**
 * Top-level slug of an issue or child issue slug, or undefined.
 * @param {string} slug
 */
export function topLevelSlug(slug) {
  for (const spec of ISSUE_SPECS) {
    if (spec.slug === slug || spec.children.some(([childSlug]) => childSlug === slug)) return spec.slug
  }
  return undefined
}

/**
 * @param {Date} now the run's start
 * @param {string} apiOrigin the fixture API's origin, for media and feed URLs
 */
export function buildFixtures(now, apiOrigin) {
  const hoursAgo = (/** @type {number} */ hours) => new Date(now.getTime() - hours * 3600_000).toISOString()

  /** @type {FixtureStory[]} */
  const stories = STORY_SPECS.map((spec, index) => {
    const [
      issueSlug,
      childSlug,
      feedId,
      emotionTag,
      relevance,
      ageHours,
      titleLabel,
      title,
      sourceTitle,
      summary,
      quote,
      quoteAttribution,
      blurb,
      reasons,
      antifactors,
      verdict,
    ] = spec
    const issue = issueSpec(issueSlug)
    const child = issue?.children.find(([slug]) => slug === childSlug)
    const feed = FEEDS.find(f => f.id === feedId) ?? FEEDS[0]
    const feedIssue = issueSpec(feed.issueSlug)
    const slug = slugify(title)
    /** @type {Omit<FixtureStory, 'aiGenerated'>} */
    const story = {
      id: `fixture-story-${index + 1}`,
      slug,
      sourceUrl: `https://example.org/fixture/${slug}`,
      sourceTitle,
      title,
      titleLabel,
      dateCrawled: hoursAgo(ageHours + 2),
      datePublished: hoursAgo(ageHours),
      status: 'published',
      relevancePre: Math.max(1, relevance - 1),
      relevance,
      emotionTag,
      summary,
      quote,
      quoteAttribution,
      marketingBlurb: blurb,
      relevanceReasons: reasons.map(r => `- ${r}`).join('\n'),
      relevanceSummary: verdict,
      antifactors: antifactors.map(a => `- ${a}`).join('\n'),
      issue: child ? { name: child[1], slug: child[0] } : { name: issue?.name ?? '', slug: issue?.slug ?? '' },
      feed: {
        id: feed.id,
        title: feed.title,
        displayTitle: feed.displayTitle,
        issue: { name: feedIssue?.name ?? '', slug: feedIssue?.slug ?? '' },
      },
    }
    return {
      ...story,
      aiGenerated: {
        fields: AI_STORY_FIELDS.filter(field => Boolean(/** @type {Record<string, unknown>} */ (story)[field])),
        model: 'fixture-model',
        digitalSourceType: IPTC_TRAINED_ALGORITHMIC_MEDIA,
      },
    }
  }).sort((a, b) => String(b.datePublished).localeCompare(String(a.datePublished)))

  const storyTopLevel = (/** @type {FixtureStory} */ story) => topLevelSlug(story.issue?.slug ?? '') ?? story.feed.issue.slug
  const sourceNamesFor = (/** @type {string} */ slug) => FEEDS.filter(feed => feed.issueSlug === slug).map(feed => feed.displayTitle ?? feed.title)

  /** @type {PublicIssue[]} */
  const issues = ISSUE_SPECS.map(spec => {
    const issueStories = stories.filter(story => storyTopLevel(story) === spec.slug)
    return {
      id: `fixture-issue-${spec.slug}`,
      name: spec.name,
      slug: spec.slug,
      description: `Invented fixture stories about ${spec.name.toLowerCase()}.`,
      intro: `These ${spec.name} stories are invented for the site harness. They show how the page lays out real coverage.`,
      evaluationIntro: 'Stories on this page are rated on three questions:',
      evaluationCriteria: ['How many people does it affect?', 'How much does it change their lives?', 'How lasting is the change?'],
      sourceNames: sourceNamesFor(spec.slug),
      makeADifference: [
        { label: 'An invented organization working on this', url: 'https://example.org/fixture/make-a-difference' },
        { label: 'Another invented way to help', url: 'https://example.net/fixture/help' },
      ],
      parentId: null,
      publishedStoryCount: issueStories.length,
      children: spec.children.map(([slug, name]) => ({
        id: `fixture-issue-${slug}`,
        name,
        slug,
        description: `Invented fixture stories about ${name.toLowerCase()}.`,
        intro: '',
        evaluationIntro: '',
        evaluationCriteria: [],
        sourceNames: sourceNamesFor(spec.slug).slice(0, 1),
        makeADifference: [],
        parentId: `fixture-issue-${spec.slug}`,
        publishedStoryCount: stories.filter(story => story.issue?.slug === slug).length,
      })),
    }
  })

  /** @type {FixtureHomepage} */
  const homepage = {
    issues,
    storiesByIssue: Object.fromEntries(
      ISSUE_SPECS.map(spec => {
        const own = stories.filter(story => storyTopLevel(story) === spec.slug)
        return [
          spec.slug,
          {
            uplifting: own.filter(s => s.emotionTag === 'uplifting'),
            calm: own.filter(s => s.emotionTag === 'calm'),
            negative: own.filter(s => s.emotionTag === 'frustrating' || s.emotionTag === 'scary'),
          },
        ]
      }),
    ),
  }

  /** @type {FixtureSources} */
  const sources = { byRegion: {}, byIssue: {}, totalCount: FEEDS.length }
  for (const feed of FEEDS) {
    const name = feed.displayTitle ?? feed.title
    ;(sources.byRegion[feed.region] ??= []).push(name)
    ;(sources.byIssue[issueSpec(feed.issueSlug)?.name ?? feed.issueSlug] ??= []).push(name)
  }

  const newsletterStory = (/** @type {FixtureStory} */ story) => ({
    headline: String(story.title),
    title: story.title,
    titleLabel: story.titleLabel,
    sourceTitle: story.sourceTitle,
    sourceUrl: story.sourceUrl,
    publisher: story.feed.displayTitle ?? story.feed.title,
    slug: story.slug,
  })

  /** @type {PublicNewsletterIssue[]} */
  const newsletters = [0, 1, 2].map(week => {
    // Two stories per section, laid out as buildContent() in server/src/services/newsletter.ts
    // writes them (after toWebMarkdown() took the markers out): a publisher line, then the
    // summary, or the quote for every third story that has one
    const picked = ISSUE_SPECS.flatMap(spec => stories.filter(story => storyTopLevel(story) === spec.slug).slice(week, week + 2))
    let position = 0
    const storyBlock = (/** @type {FixtureStory} */ story) => {
      const useQuote = position++ % 3 === 2 && story.quote && story.quoteAttribution
      const meta = [
        story.feed.displayTitle ?? story.feed.title,
        `[original article](${story.sourceUrl})`,
        `[relevance analysis](https://actuallyrelevant.news/stories/${story.slug})`,
      ].join(' · ')
      const body = useQuote ? `> "${story.quote}"\n> — ${story.quoteAttribution}` : story.summary
      return `## ${story.title}\n${meta}\n\n${body}`
    }
    const sections = ISSUE_SPECS.map(spec => {
      const own = picked.filter(story => storyTopLevel(story) === spec.slug)
      if (own.length === 0) return ''
      return `# ${spec.name}\n\n${own.map(storyBlock).join('\n\n')}`
    }).filter(Boolean)
    const number = 3 - week
    return {
      slug: `fixture-issue-${number}`,
      // Shaped like a real issue title ("Week 42, 2026")
      title: `Fixture week ${number}, 2026`,
      publishedAt: hoursAgo(30 + week * 24 * 7),
      aiLabel: { lead: NEWSLETTER_TOP_LABEL.lead, text: NEWSLETTER_TOP_LABEL.text },
      content: `${sections.join('\n\n---\n\n')}\n`,
      stories: picked.map(newsletterStory),
      aiGenerated: { fields: ['content', 'stories'], digitalSourceType: IPTC_TRAINED_ALGORITHMIC_MEDIA },
    }
  })

  /** @type {PublicNewsletterIssueSummary[]} */
  const newsletterSummaries = newsletters.map(issue => ({
    slug: issue.slug,
    title: issue.title,
    publishedAt: issue.publishedAt,
    storyCount: issue.stories.length,
  }))

  const episodeStory = (/** @type {FixtureStory} */ story) => ({
    title: String(story.title),
    publisher: story.feed.displayTitle ?? story.feed.title,
    sourceUrl: story.sourceUrl,
    slug: story.slug,
  })

  /** @type {PublicPodcastEpisodeDetail[]} */
  const episodes = [0, 1, 2].map(week => {
    const picked = ISSUE_SPECS.map(spec => stories.filter(story => storyTopLevel(story) === spec.slug)[week]).filter(s => s !== undefined)
    const number = 3 - week
    /** @type {PublicPodcastEpisodeDetail['transcript']} */
    const transcript = [
      {
        story: null,
        turns: [
          { speaker: 'Host A', text: PODCAST_OPENER },
          { speaker: 'Host B', text: `This is fixture episode ${number}, made up for the site harness. ${picked.length} stories this week.` },
        ],
      },
      ...picked.map(story => ({
        story: episodeStory(story),
        turns: /** @type {{ speaker: 'Host A' | 'Host B', text: string }[]} */ ([
          { speaker: 'Host A', text: `First up: ${story.title}.` },
          { speaker: 'Host B', text: String(story.summary) },
          { speaker: 'Host A', text: `Why it matters: ${story.relevanceSummary}` },
        ]),
      })),
      { story: null, turns: [{ speaker: 'Host A', text: PODCAST_SIGN_OFF }] },
    ]
    return {
      id: `fixture-episode-${number}`,
      title: `Fixture episode ${number}: ${picked.map(s => String(s.titleLabel).toLowerCase()).join(', ')}`,
      aiLine: PODCAST_EPISODE_AI_LINE,
      summary: `An invented episode about ${picked.map(s => String(s.titleLabel).toLowerCase()).join(', ')}.`,
      publishedAt: hoursAgo(20 + week * 24 * 7),
      durationSec: 312 - week * 17,
      audioUrl: `${apiOrigin}/fixture-media/episode-${number}.wav`,
      audioBytes: 16044,
      transcriptUrl: null,
      stories: picked.map(episodeStory),
      aiGenerated: { fields: ['title', 'summary', 'audioUrl', 'transcriptUrl', 'transcript'], digitalSourceType: IPTC_TRAINED_ALGORITHMIC_MEDIA },
      transcript,
    }
  })

  /** @type {PublicPodcastResponse} */
  const podcast = {
    show: {
      title: 'Actually Relevant',
      description: PODCAST_SHOW_DESCRIPTION,
      feedUrl: `${apiOrigin}/api/podcast/feed.xml`,
      artworkUrl: `${apiOrigin}/fixture-media/artwork.svg`,
      listenLinks: [
        { name: 'Apple Podcasts', url: 'https://podcasts.apple.com/us/podcast/fixture/id0000000000' },
        { name: 'Spotify', url: 'https://open.spotify.com/show/fixture' },
        { name: 'Pocket Casts', url: 'https://pca.st/fixture' },
      ],
    },
    episodes: episodes.map(({ transcript: _transcript, ...episode }) => {
      /** @type {PublicPodcastEpisode} */
      const listed = {
        ...episode,
        aiGenerated: { fields: ['title', 'summary', 'audioUrl', 'transcriptUrl'], digitalSourceType: IPTC_TRAINED_ALGORITHMIC_MEDIA },
      }
      return listed
    }),
  }

  return { stories, issues, homepage, sources, newsletters, newsletterSummaries, podcast, episodes }
}

/**
 * The site's pages these fixtures fill, for `--list-routes`: the static pages, then each child
 * issue, story, newsletter issue and episode transcript (the dynamic routes in client/src/App.tsx).
 * @param {ReturnType<typeof buildFixtures>} fixtures
 * @param {string[]} staticPaths the paths in shared/routes.json
 * @returns {string[]}
 */
export function fixtureRoutes(fixtures, staticPaths) {
  return [
    ...staticPaths,
    ...fixtures.issues.flatMap(issue => (issue.children ?? []).map(child => `/issues/${child.slug}`)),
    ...fixtures.stories.map(story => `/stories/${story.slug}`),
    ...fixtures.newsletters.map(issue => `/newsletter/${issue.slug}`),
    ...fixtures.episodes.map(episode => `/podcast/${episode.id}/transcript`),
  ]
}

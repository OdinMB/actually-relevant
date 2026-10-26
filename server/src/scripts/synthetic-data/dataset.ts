/**
 * The synthetic data set for local development (`seed.ts` writes it; `.context/database-migrations.md`,
 * "Run Locally with Synthetic Data"): issues, feeds, stories in every pipeline status, a dedup cluster,
 * newsletter issues and podcast episodes. Every place, organization and event is invented, every URL
 * is on synthetic.example.org (apart from the newsletters' links to story pages, which use `siteUrl`)
 * and every email address on example.org. Ids and text are fixed. The dates count back from `now` so
 * the site looks current, and the newsletter titles and slugs and the podcast week keys follow them:
 * the same `now` and `siteUrl` give the same rows.
 */
import { createHash } from 'node:crypto'
import type { EmotionTag, FeedRegion, Prisma, RejectionReason, StoryStatus } from '@prisma/client'
import { slugify } from '../../utils/slugify.js'
import { storyHeading } from '../../services/newsletterContent.js'
import { newsletterSlugBase } from '../../services/newsletterArchive.js'

export const SYNTHETIC_ORIGIN = 'https://synthetic.example.org'
export const SYNTHETIC_EMAIL_DOMAIN = '@example.org'

/** The admin login: a throwaway, documented, for a database that never leaves the machine. */
export const SYNTHETIC_ADMIN = { email: 'admin@example.org', name: 'Synthetic Admin', password: 'synthetic-admin' } as const

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const WEEK_HOURS = 7 * 24

/** A stable UUID-shaped id for `key`, so every run writes the same ids. */
export function syntheticId(key: string): string {
  const h = createHash('sha256').update(`actually-relevant-synthetic:${key}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}

const issueId = (slug: string) => syntheticId(`issue:${slug}`)
const feedId = (key: string) => syntheticId(`feed:${key}`)
const storyId = (key: string) => syntheticId(`story:${key}`)
const hoursBefore = (now: Date, hours: number) => new Date(now.getTime() - hours * HOUR_MS)

/** ISO week of `date` in UTC: the rule of `isoWeekKey` in podcastWeekly.ts, whose module loads the podcast pipeline and the LLM layer. */
export function isoWeek(date: Date): { year: number; week: number; key: string } {
  const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  thursday.setUTCDate(thursday.getUTCDate() + 3 - ((thursday.getUTCDay() + 6) % 7))
  const year = thursday.getUTCFullYear()
  const week = Math.ceil(((thursday.getTime() - Date.UTC(year, 0, 1)) / DAY_MS + 1) / 7)
  return { year, week, key: `${year}-W${String(week).padStart(2, '0')}` }
}

// ──── Issues ──────────────────────────────────────────────────────────────

interface IssueSeed {
  slug: string
  name: string
  description: string
}

/** The live site's issue slugs and names (the client keys colors, routes and the homepage on them), with made-up text. */
const TOP_LEVEL_ISSUES: IssueSeed[] = [
  { slug: 'human-development', name: 'Human Development', description: "People's access to health, education, income and basic rights." },
  { slug: 'planet-climate', name: 'Planet & Climate', description: 'Climate change, ecosystems and the natural systems everyone depends on.' },
  { slug: 'existential-threats', name: 'Existential Threats', description: 'Risks that could end or permanently cripple human civilization.' },
  { slug: 'science-technology', name: 'Science & Technology', description: 'Discoveries and inventions that change what humanity can do.' },
  { slug: 'general-news', name: 'General News', description: "Stories that don't fit into any other category." },
]

const CHILD_ISSUES: (IssueSeed & { parent: string })[] = [
  { slug: 'artificial-intelligence', name: 'Artificial Intelligence', parent: 'existential-threats', description: 'Risks from advanced AI systems.' },
  { slug: 'nuclear-war', name: '(Nuclear) War', parent: 'existential-threats', description: 'Nuclear weapons and large-scale war.' },
  { slug: 'pandemics', name: 'Pandemics', parent: 'existential-threats', description: 'Natural and accidental pandemics.' },
  { slug: 'bioterrorism-and-bioweapons', name: 'Bioterrorism and Bioweapons', parent: 'existential-threats', description: 'Deliberate biological threats.' },
  { slug: 'natural-catastrophes', name: 'Natural Catastrophes', parent: 'existential-threats', description: 'Asteroids, supervolcanoes and solar storms.' },
  {
    slug: 'global-governance-failure',
    name: 'Global Governance Failure',
    parent: 'existential-threats',
    description: 'Breakdowns in international cooperation.',
  },
]

const PARENT_OF = new Map(CHILD_ISSUES.map(issue => [issue.slug, issue.parent]))
const topLevelOf = (slug: string) => PARENT_OF.get(slug) ?? slug
const ISSUE_NAME = new Map([...TOP_LEVEL_ISSUES, ...CHILD_ISSUES].map(issue => [issue.slug, issue.name]))

function topLevelIssueRow(issue: IssueSeed): Prisma.IssueCreateManyInput {
  return {
    id: issueId(issue.slug),
    name: issue.name,
    slug: issue.slug,
    description: issue.description,
    intro: `${issue.description} This text belongs to the synthetic development data; the live site describes the issue in its own words.`,
    evaluationIntro: 'We rate stories in this area on three criteria:',
    evaluationCriteria: JSON.stringify([
      'How many people the development affects, and how strongly',
      'How long the change is likely to last',
      'Whether it changes what comparable places or institutions do next',
    ]),
    makeADifference: JSON.stringify([{ label: 'Example organization', url: `${SYNTHETIC_ORIGIN}/act/${issue.slug}` }]),
  }
}

function childIssueRow(issue: IssueSeed & { parent: string }): Prisma.IssueCreateManyInput {
  return { id: issueId(issue.slug), name: issue.name, slug: issue.slug, description: issue.description, parentId: issueId(issue.parent) }
}

// ──── Feeds ───────────────────────────────────────────────────────────────

interface FeedSeed {
  key: string
  title: string
  issue: string
  region: FeedRegion
  /** Fields that differ from a feed that crawls fine. */
  health?: (now: Date) => Partial<Prisma.FeedCreateManyInput>
}

/** Three made-up publishers per top-level issue; one switched off and one failing, so the feed admin shows both states. */
const FEEDS: FeedSeed[] = [
  { key: 'wendrake-courier', title: 'The Wendrake Courier', issue: 'human-development', region: 'western_europe' },
  { key: 'pellomar-monitor', title: 'Pellomar Islands Monitor', issue: 'human-development', region: 'pacific' },
  { key: 'morvantia-plains-dispatch', title: 'Morvantia Plains Dispatch', issue: 'human-development', region: 'sub_saharan_africa' },
  { key: 'brinemoor-observer', title: 'Brinemoor Observer', issue: 'planet-climate', region: 'north_america' },
  { key: 'varrowen-valley-review', title: 'Varrowen Valley Review', issue: 'planet-climate', region: 'latin_america' },
  { key: 'lake-ulvenna-bulletin', title: 'Lake Ulvenna Bulletin', issue: 'planet-climate', region: 'eastern_europe' },
  { key: 'lorrimay-horizon-report', title: 'Lorrimay Horizon Report', issue: 'existential-threats', region: 'global' },
  { key: 'quarrow-accord-monitor', title: 'Quarrow Arms & Accord Monitor', issue: 'existential-threats', region: 'global' },
  { key: 'pellomar-biosafety-briefing', title: 'Pellomar Biosafety Briefing', issue: 'existential-threats', region: 'global' },
  { key: 'ketterwyn-lab-notes', title: 'Ketterwyn Lab Notes', issue: 'science-technology', region: 'north_america' },
  { key: 'quenridge-science-weekly', title: 'Quenridge Science Weekly', issue: 'science-technology', region: 'western_europe' },
  {
    key: 'drevania-circuit-cell',
    title: 'Drevania Circuit & Cell',
    issue: 'science-technology',
    region: 'south_southeast_asia',
    health: now => ({
      consecutiveFailedCrawls: 4,
      lastCrawlError: 'getaddrinfo ENOTFOUND synthetic.example.org (synthetic feed)',
      lastCrawlErrorAt: hoursBefore(now, 2),
      lastSuccessfulCrawlAt: hoursBefore(now, 50),
    }),
  },
  { key: 'norvessa-daily', title: 'Norvessa Daily', issue: 'general-news', region: 'western_europe' },
  { key: 'corvane-herald', title: 'Corvane Herald', issue: 'general-news', region: 'north_america' },
  {
    key: 'morvantia-desert-news',
    title: 'Morvantia Desert News',
    issue: 'general-news',
    region: 'middle_east_north_africa',
    // Switched off after its last story (a feed with stories is deactivated, never deleted)
    health: now => ({ active: false, lastCrawledAt: hoursBefore(now, 400), lastSuccessfulCrawlAt: hoursBefore(now, 400) }),
  },
]

const FEED_TITLE = new Map(FEEDS.map(feed => [feed.key, feed.title]))
const feedTitle = (key: string) => FEED_TITLE.get(key)!

function feedRow(feed: FeedSeed, now: Date): Prisma.FeedCreateManyInput {
  const lastCrawl = hoursBefore(now, 2)
  return {
    id: feedId(feed.key),
    title: feed.title,
    rssUrl: `${SYNTHETIC_ORIGIN}/${feed.key}/rss.xml`,
    url: `${SYNTHETIC_ORIGIN}/${feed.key}`,
    region: feed.region,
    issueId: issueId(feed.issue),
    crawlIntervalHours: 12,
    lastCrawledAt: lastCrawl,
    lastSuccessfulCrawlAt: lastCrawl,
    ...feed.health?.(now),
  }
}

// ──── Stories ─────────────────────────────────────────────────────────────

interface StorySeed {
  key: string
  status: StoryStatus
  reason?: RejectionReason
  /** The assigned issue (a sub-issue for existential threats). */
  issue: string
  feed: string
  emotion: EmotionTag
  /** The final rating; for a story that only got the screening, its screening rating. */
  relevance: number
  label: string
  title: string
  /** What happened, in one sentence. */
  gist: string
  /** Why it matters, in one sentence. */
  why: string
}

/**
 * Newest first: a story's crawl time is 4 + 12 × its position hours ago. Published stories cycle
 * through the issues, so every homepage section has uplifting, calm and negative stories, and the
 * weeks behind the newsletter issues and podcast episodes each hold enough of them.
 */
const STORIES: StorySeed[] = [
  {
    key: 'pellomar-ferry',
    status: 'fetched',
    issue: 'general-news',
    feed: 'pellomar-monitor',
    emotion: 'calm',
    relevance: 3,
    label: 'Transport',
    title: 'Pellomar Islands council approves a new ferry route',
    gist: 'The Pellomar Islands council approved a daily ferry between the two largest islands, starting next summer.',
    why: 'A reliable ferry shortens trips to the only hospital on the islands.',
  },
  {
    key: 'varrowen-clinics',
    status: 'pre_analyzed',
    issue: 'human-development',
    feed: 'morvantia-plains-dispatch',
    emotion: 'uplifting',
    relevance: 6,
    label: 'Rural health',
    title: 'Varrowen Province opens three rural clinics',
    gist: 'Varrowen Province opened three clinics in villages that were more than a day from the nearest doctor.',
    why: 'Primary care close to home prevents many deaths from treatable illness.',
  },
  {
    key: 'pellomar-plastics',
    status: 'analyzed',
    issue: 'planet-climate',
    feed: 'brinemoor-observer',
    emotion: 'uplifting',
    relevance: 6,
    label: 'Plastic pollution',
    title: 'Pellomar Islands ban single-use plastics from 2028',
    gist: 'The Pellomar Islands will ban single-use plastic bags, cups and cutlery from 2028, with a refund scheme for bottles.',
    why: 'Island beaches and fisheries carry much of the cost of plastic waste, and small states often set the example for larger ones.',
  },
  {
    key: 'norvessa-libraries',
    status: 'published',
    issue: 'general-news',
    feed: 'norvessa-daily',
    emotion: 'uplifting',
    relevance: 5,
    label: 'Public libraries',
    title: 'Norvessa libraries drop late fees and see borrowing rise',
    gist: 'Public libraries in Norvessa dropped late fees and saw borrowing rise by a quarter within six months.',
    why: 'Removing fees widens access to books and learning for low-income families.',
  },
  {
    key: 'wendrake-campus',
    status: 'fetched',
    issue: 'general-news',
    feed: 'wendrake-courier',
    emotion: 'calm',
    relevance: 3,
    label: 'Education',
    title: 'Wendrake university announces a new engineering campus',
    gist: 'The university in Port Wendrake will build an engineering campus on the site of a former shipyard.',
    why: 'The campus could anchor jobs in a district that lost its main employer.',
  },
  {
    key: 'quarrow-port',
    status: 'pre_analyzed',
    issue: 'general-news',
    feed: 'corvane-herald',
    emotion: 'calm',
    relevance: 4,
    label: 'Trade',
    title: 'Quarrow Bay port expands its container terminal',
    gist: 'The port of Quarrow Bay began work on a second container terminal that doubles its capacity.',
    why: 'More capacity could lower shipping costs for the region, though the effect on wider trade is small.',
  },
  {
    key: 'lorrimay-rice',
    status: 'selected',
    issue: 'planet-climate',
    feed: 'varrowen-valley-review',
    emotion: 'uplifting',
    relevance: 7,
    label: 'Climate adaptation',
    title: 'Lorrimay Delta farmers switch to salt-tolerant rice',
    gist: 'Two thirds of rice farmers in the Lorrimay Delta now plant a salt-tolerant variety as seawater pushes further inland.',
    why: 'Rising salinity threatens food supplies in river deltas worldwide, and adaptation at this scale shows it can be done.',
  },
  {
    key: 'varrowen-lunches',
    status: 'published',
    issue: 'human-development',
    feed: 'morvantia-plains-dispatch',
    emotion: 'uplifting',
    relevance: 7,
    label: 'School meals',
    title: 'Varrowen Province makes free school lunches permanent for 600,000 pupils',
    gist: 'Lawmakers in Varrowen Province voted to fund free lunches in every public school, turning a two-year pilot into a permanent budget line.',
    why: 'Free meals raise attendance and learning, and a permanent budget line protects them from the next round of cuts.',
  },
  {
    key: 'drevania-teachers',
    status: 'analyzed',
    issue: 'human-development',
    feed: 'wendrake-courier',
    emotion: 'frustrating',
    relevance: 6,
    label: 'Education',
    title: 'Survey finds one in five Drevanian teachers plan to quit',
    gist: 'A survey of 8,000 teachers in Drevania found that one in five plan to leave the profession within two years, citing pay and workload.',
    why: 'Teacher shortages hit the poorest schools first and take years to reverse.',
  },
  {
    key: 'quenridge-reactor-exclusive',
    status: 'rejected',
    reason: 'paywall',
    issue: 'science-technology',
    feed: 'quenridge-science-weekly',
    emotion: 'calm',
    relevance: 5,
    label: 'Energy research',
    title: 'Exclusive: inside the Quenridge fusion reactor project',
    gist: 'Subscribers only: a look inside the Quenridge fusion reactor project.',
    why: 'The article is behind a paywall, so only its teaser was crawled.',
  },
  {
    key: 'iron-air-batteries',
    status: 'published',
    issue: 'science-technology',
    feed: 'ketterwyn-lab-notes',
    emotion: 'uplifting',
    relevance: 7,
    label: 'Energy storage',
    title: 'Iron-air battery plant in Dunmerrow begins grid-scale production',
    gist: 'A factory in Dunmerrow started producing iron-air batteries that store power for up to 100 hours at a fraction of the cost of lithium.',
    why: 'Cheap long-duration storage is one of the missing pieces for a grid that runs mostly on wind and sun.',
  },
  {
    key: 'norvessa-rail',
    status: 'fetched',
    issue: 'general-news',
    feed: 'norvessa-daily',
    emotion: 'calm',
    relevance: 3,
    label: 'Transport',
    title: 'Norvessa rail link reopens after flood repairs',
    gist: 'The northern rail link through Norvessa reopened after three months of repairs to flood-damaged track.',
    why: 'The line is the only freight route to several inland towns.',
  },
  {
    key: 'ulvenna-algae',
    status: 'pre_analyzed',
    issue: 'planet-climate',
    feed: 'lake-ulvenna-bulletin',
    emotion: 'frustrating',
    relevance: 5,
    label: 'Water quality',
    title: 'Ulvenna Basin Authority reports an early algae bloom',
    gist: 'An algae bloom appeared on Lake Ulvenna six weeks earlier than usual, closing two beaches.',
    why: 'Earlier blooms point to warmer water and fertilizer runoff that threaten the lake as a drinking water source.',
  },
  {
    key: 'border-weapons-treaty',
    status: 'selected',
    issue: 'nuclear-war',
    feed: 'quarrow-accord-monitor',
    emotion: 'calm',
    relevance: 7,
    label: 'Arms control',
    title: 'Neighbors agree to ban weapons tests within 100 km of their border',
    gist: 'Drevania and the Republic of Morvantia agreed to stop all weapons testing within 100 kilometers of their shared border.',
    why: 'Fewer tests near a contested border lower the risk that an accident is mistaken for an attack.',
  },
  {
    key: 'flood-warning-satellites',
    status: 'analyzed',
    issue: 'science-technology',
    feed: 'quenridge-science-weekly',
    emotion: 'calm',
    relevance: 7,
    label: 'Early warning',
    title: 'Satellite network to send free flood warnings to phones',
    gist: 'A public satellite network will send free flood warnings to phones in river basins that have no warning system today.',
    why: 'Early warnings are among the cheapest ways to save lives in floods, which are becoming more frequent.',
  },
  {
    key: 'wendrake-chef',
    status: 'rejected',
    reason: 'assess_threshold',
    issue: 'general-news',
    feed: 'wendrake-courier',
    emotion: 'calm',
    relevance: 2,
    label: 'Food',
    title: 'Celebrity chef opens a restaurant in Port Wendrake',
    gist: 'A television chef opened a seafood restaurant on the Port Wendrake waterfront.',
    why: 'Local interest only.',
  },
  {
    key: 'wendrake-tidal-barrier',
    status: 'published',
    issue: 'planet-climate',
    feed: 'brinemoor-observer',
    emotion: 'uplifting',
    relevance: 8,
    label: 'Coastal adaptation',
    title: 'Port Wendrake opens a tidal barrier that protects 40,000 homes',
    gist: 'Port Wendrake switched on a movable tidal barrier that closes during storm surges and protects about 40,000 homes in the low-lying harbor district.',
    why: 'Rising seas threaten hundreds of coastal cities, and a working barrier shows what timely adaptation can achieve.',
  },
  {
    key: 'wendrake-tidal-barrier-courier',
    status: 'rejected',
    reason: 'duplicate',
    issue: 'planet-climate',
    feed: 'wendrake-courier',
    emotion: 'uplifting',
    relevance: 7,
    label: 'Coastal adaptation',
    title: 'Harbor district gets its storm-surge barrier at last',
    gist: 'After six years of construction, the storm-surge barrier for the Port Wendrake harbor district is in operation.',
    why: 'Rising seas threaten hundreds of coastal cities, and a working barrier shows what timely adaptation can achieve.',
  },
  {
    key: 'wendrake-tidal-barrier-review',
    status: 'rejected',
    reason: 'duplicate',
    issue: 'planet-climate',
    feed: 'varrowen-valley-review',
    emotion: 'uplifting',
    relevance: 7,
    label: 'Coastal adaptation',
    title: 'Tidal gates go live in Port Wendrake',
    gist: 'The tidal gates protecting Port Wendrake closed for the first time during a test this week.',
    why: 'Coastal cities elsewhere are watching how the gates perform in a real storm.',
  },
  {
    key: 'ai-safety-registry',
    status: 'published',
    issue: 'artificial-intelligence',
    feed: 'lorrimay-horizon-report',
    emotion: 'calm',
    relevance: 7,
    label: 'AI safety',
    title: 'Five AI labs agree to share safety test results in a public registry',
    gist: 'Five developers of large AI models agreed to publish the results of standardized safety tests in a public registry run by an independent foundation.',
    why: 'Shared safety evidence lets outsiders check claims about frontier systems before they are widely deployed.',
  },
  {
    key: 'lorrimay-cash',
    status: 'published',
    issue: 'human-development',
    feed: 'pellomar-monitor',
    emotion: 'calm',
    relevance: 6,
    label: 'Cash transfers',
    title: 'Study tracks ten years of monthly cash payments in the Lorrimay Delta',
    gist: 'Researchers following 12,000 households in the Lorrimay Delta found that small monthly payments raised earnings and school completion a decade later.',
    why: 'Long-term evidence on cash transfers is rare, and it informs how governments design social protection.',
  },
  {
    key: 'river-fever-vaccine',
    status: 'published',
    issue: 'science-technology',
    feed: 'quenridge-science-weekly',
    emotion: 'uplifting',
    relevance: 8,
    label: 'Medicine',
    title: 'Quenridge University trial shows a single-dose vaccine for river fever',
    gist: 'A clinical trial at Quenridge University found that one dose of a new vaccine prevented 85 percent of river fever cases over two years.',
    why: 'River fever sickens millions each year, and a single dose is much easier to deliver than a multi-dose schedule.',
  },
  {
    key: 'square-renamed',
    status: 'rejected',
    reason: 'select_threshold',
    issue: 'general-news',
    feed: 'corvane-herald',
    emotion: 'calm',
    relevance: 3,
    label: 'Local politics',
    title: 'Corvane council renames a downtown square',
    gist: 'The Corvane council voted to rename Market Square after the town founder.',
    why: 'A symbolic local decision with little effect beyond the town.',
  },
  {
    key: 'ai-phishing',
    status: 'published',
    issue: 'artificial-intelligence',
    feed: 'lorrimay-horizon-report',
    emotion: 'scary',
    relevance: 8,
    label: 'AI misuse',
    title: 'Report finds AI tools made large-scale phishing ten times cheaper',
    gist: 'A report by the Drevanian Coalition for Safe Computing estimates that AI tools cut the cost of running large phishing campaigns by a factor of ten in one year.',
    why: 'Cheaper attacks put more people and institutions at risk and show how quickly misuse can scale.',
  },
  {
    key: 'norvessa-regrowth',
    status: 'published',
    issue: 'planet-climate',
    feed: 'lake-ulvenna-bulletin',
    emotion: 'uplifting',
    relevance: 7,
    label: 'Reforestation',
    title: 'Norvessa regrows 50,000 hectares of forest on former farmland',
    gist: 'Norvessa says natural regrowth on abandoned farmland has added 50,000 hectares of young forest in fifteen years, confirmed by satellite surveys.',
    why: 'Natural regrowth stores carbon and restores habitat at a fraction of the cost of planting.',
  },
  {
    key: 'pellomar-flights',
    status: 'rejected',
    reason: 'selection',
    issue: 'general-news',
    feed: 'norvessa-daily',
    emotion: 'calm',
    relevance: 5,
    label: 'Travel',
    title: 'Regional airline adds weekend flights to the Pellomar Islands',
    gist: 'A regional airline added two weekend flights to the Pellomar Islands for the tourist season.',
    why: 'More flights help the island economy, but the story mostly matters to travelers.',
  },
  {
    key: 'dunmerrow-lead-pipes',
    status: 'published',
    issue: 'human-development',
    feed: 'wendrake-courier',
    emotion: 'calm',
    relevance: 6,
    label: 'Clean water',
    title: 'Dunmerrow finishes replacing its last lead water pipes',
    gist: 'The town of Dunmerrow replaced the final 3,200 lead service lines in its water network, two years ahead of schedule and under budget.',
    why: "Lead exposure harms children's development for life, and an on-budget replacement gives other towns a template.",
  },
  {
    key: 'drought-wheat',
    status: 'published',
    issue: 'science-technology',
    feed: 'ketterwyn-lab-notes',
    emotion: 'calm',
    relevance: 6,
    label: 'Agriculture',
    title: 'Drought-tolerant wheat released to small farms for free',
    gist: 'Plant breeders released a wheat variety that kept 80 percent of its yield in dry-season field trials, with seed free for small farms.',
    why: 'Crops that withstand drought protect food supplies as rainfall becomes less reliable.',
  },
  {
    key: 'inspection-treaty',
    status: 'published',
    issue: 'nuclear-war',
    feed: 'quarrow-accord-monitor',
    emotion: 'uplifting',
    relevance: 8,
    label: 'Arms control',
    title: 'Drevania and Morvantia extend their nuclear inspection treaty by ten years',
    gist: 'Drevania and the Republic of Morvantia renewed their mutual nuclear inspection treaty for ten years, with on-site visits resuming next spring.',
    why: 'Verification reduces the risk of miscalculation between nuclear-armed rivals.',
  },
  {
    key: 'norvessa-grid-week',
    status: 'published',
    issue: 'planet-climate',
    feed: 'brinemoor-observer',
    emotion: 'calm',
    relevance: 6,
    label: 'Energy transition',
    title: 'Norvessa grid runs on renewables for a full week',
    gist: 'The Norvessa Grid Cooperative ran its regional network on wind, solar and hydro power for seven straight days for the first time.',
    why: 'A full week without fossil backup tests the storage and grid management that a clean energy system needs.',
  },
  {
    key: 'ulvenna-dam-opinion',
    status: 'rejected',
    reason: 'editor',
    issue: 'planet-climate',
    feed: 'lake-ulvenna-bulletin',
    emotion: 'frustrating',
    relevance: 5,
    label: 'Opinion',
    title: 'Opinion: why Lake Ulvenna needs a new dam',
    gist: 'A columnist argues that a new dam is the only way to secure water for the growing towns around Lake Ulvenna.',
    why: 'An opinion piece rather than news, which an editor rejected.',
  },
  {
    key: 'quarrow-overtime',
    status: 'published',
    issue: 'human-development',
    feed: 'morvantia-plains-dispatch',
    emotion: 'frustrating',
    relevance: 7,
    label: 'Labor rights',
    title: 'Garment workers in Quarrow Bay lose overtime protections under new rules',
    gist: 'New rules in Quarrow Bay let factories extend shifts to twelve hours without overtime pay, affecting an estimated 90,000 garment workers.',
    why: 'Weaker protections for a large low-wage workforce can spread through supply chains to competing regions.',
  },
  {
    key: 'open-farm-robot',
    status: 'published',
    issue: 'science-technology',
    feed: 'drevania-circuit-cell',
    emotion: 'calm',
    relevance: 5,
    label: 'Open science',
    title: 'Ketterwyn Robotics Lab publishes its farm robot designs under an open license',
    gist: 'The Ketterwyn Robotics Lab released the full designs and software for its low-cost farm robot under an open license.',
    why: 'Open designs let small manufacturers and researchers build on the work without license fees.',
  },
  {
    key: 'corvane-budget',
    status: 'published',
    issue: 'general-news',
    feed: 'corvane-herald',
    emotion: 'calm',
    relevance: 5,
    label: 'Local democracy',
    title: 'Corvane opens part of its budget to a citizen vote',
    gist: "Residents of Corvane will vote directly on how to spend 10 percent of the town's budget, starting next year.",
    why: 'Participatory budgeting can raise trust in local government, though results vary by design.',
  },
  {
    key: 'virus-sequencing-network',
    status: 'published',
    issue: 'pandemics',
    feed: 'pellomar-biosafety-briefing',
    emotion: 'uplifting',
    relevance: 7,
    label: 'Pandemic preparedness',
    title: 'Regional lab network can now sequence a new virus within 48 hours',
    gist: 'A network of twelve public health labs can now sequence and share the genome of a new pathogen within 48 hours of the first sample.',
    why: 'Fast sequencing shortens the time to tests and vaccines when a new outbreak starts.',
  },
  {
    key: 'morvantia-desert-listings',
    status: 'trashed',
    issue: 'general-news',
    feed: 'morvantia-desert-news',
    emotion: 'calm',
    relevance: 2,
    label: 'Events',
    title: 'Weekly event listings for the Morvantia desert towns',
    gist: 'Concerts, markets and club meetings in the Morvantia desert towns this week.',
    why: 'A listings page rather than a story.',
  },
  {
    key: 'ulvenna-levels',
    status: 'published',
    issue: 'planet-climate',
    feed: 'lake-ulvenna-bulletin',
    emotion: 'calm',
    relevance: 5,
    label: 'Freshwater',
    title: 'Lake Ulvenna water levels hold steady after a decade of decline',
    gist: 'Water levels in Lake Ulvenna have held steady for two years since farms in the basin adopted metered irrigation.',
    why: 'Lake Ulvenna supplies drinking water to 3 million people, and the result suggests that limits on demand can work.',
  },
  {
    key: 'morvantia-drought',
    status: 'published',
    issue: 'human-development',
    feed: 'pellomar-monitor',
    emotion: 'scary',
    relevance: 8,
    label: 'Food security',
    title: 'Drought leaves 2 million people in the Morvantia Highlands short of food',
    gist: 'A third failed rainy season has left about 2 million people in the Morvantia Highlands facing acute food shortages, according to regional aid groups.',
    why: 'The scale is large and the crisis is likely to worsen without funding, with lasting effects on child nutrition.',
  },
  {
    key: 'research-funding-cut',
    status: 'published',
    issue: 'science-technology',
    feed: 'quenridge-science-weekly',
    emotion: 'frustrating',
    relevance: 6,
    label: 'Research funding',
    title: 'Drevania cuts public research funding by a fifth',
    gist: "Drevania's new budget reduces public research funding by 20 percent, ending support for several long-running climate and health studies.",
    why: 'Interrupted long-term studies are hard to restart, and their data informs policy far beyond one country.',
  },
  {
    key: 'asteroid-survey',
    status: 'published',
    issue: 'natural-catastrophes',
    feed: 'lorrimay-horizon-report',
    emotion: 'calm',
    relevance: 5,
    label: 'Planetary defense',
    title: 'Telescope survey completes its map of large near-Earth asteroids',
    gist: 'A ten-year telescope survey says it has now tracked more than 95 percent of near-Earth asteroids larger than one kilometer.',
    why: 'Knowing where large asteroids are is the first step toward deflecting one.',
  },
  {
    key: 'coal-delay',
    status: 'published',
    issue: 'planet-climate',
    feed: 'varrowen-valley-review',
    emotion: 'frustrating',
    relevance: 6,
    label: 'Climate policy',
    title: 'Drevania delays its coal phase-out by eight years',
    gist: 'The Drevanian government postponed the closure of its last coal plants from 2030 to 2038, citing grid reliability.',
    why: 'The delay adds substantial emissions and weakens a regional commitment that neighbors had matched.',
  },
  {
    key: 'resistant-infections',
    status: 'published',
    issue: 'science-technology',
    feed: 'drevania-circuit-cell',
    emotion: 'scary',
    relevance: 7,
    label: 'Antibiotic resistance',
    title: 'Hospital survey finds a drug-resistant infection in 1 in 12 patients',
    gist: 'A survey of 200 hospitals in the region found infections resistant to last-line antibiotics in one in twelve patients tested.',
    why: 'Resistance threatens routine surgery and childbirth, and the rate has doubled in five years.',
  },
  {
    key: 'pandemic-fund-talks',
    status: 'published',
    issue: 'global-governance-failure',
    feed: 'pellomar-biosafety-briefing',
    emotion: 'frustrating',
    relevance: 6,
    label: 'International cooperation',
    title: 'Talks on a shared pandemic fund collapse without agreement',
    gist: 'Negotiators from 40 countries ended talks on a shared pandemic response fund without agreeing on who pays.',
    why: 'Without pooled funding, poorer countries may again wait longest for tests and vaccines.',
  },
  {
    key: 'drevania-malaria',
    status: 'published',
    issue: 'human-development',
    feed: 'wendrake-courier',
    emotion: 'uplifting',
    relevance: 8,
    label: 'Child health',
    title: 'Drevania cuts child malaria deaths by a third with village health workers',
    gist: 'A national program that trained 4,000 village health workers in Drevania reports a one-third drop in child deaths from malaria over three seasons.',
    why: 'Community health workers are cheap to train, so a model that works at national scale could be copied across many countries.',
  },
  {
    key: 'pellomar-coral',
    status: 'published',
    issue: 'planet-climate',
    feed: 'brinemoor-observer',
    emotion: 'scary',
    relevance: 8,
    label: 'Biodiversity',
    title: 'Coral survey finds 60 percent bleaching across the Pellomar Islands reef',
    gist: "A survey of the Pellomar Islands reef found that 60 percent of its coral bleached during this year's marine heatwave.",
    why: 'Reefs support fisheries and coastal protection for millions, and repeated bleaching leaves little time for recovery.',
  },
]

/** The dedup cluster: the published barrier story and the two other feeds' reports of it, rejected as duplicates. */
const CLUSTER = { primary: 'wendrake-tidal-barrier', members: ['wendrake-tidal-barrier', 'wendrake-tidal-barrier-courier', 'wendrake-tidal-barrier-review'] }

const SUMMARY_ENDINGS = [
  'Officials expect a first progress report within a year.',
  'Observers say the effect will depend on funding and on how the plan is carried out.',
  'The work builds on a two-year pilot that reported similar results.',
  'Independent researchers plan to publish their own assessment next year.',
]

const QUOTES = [
  ['The numbers are clear, and we will keep publishing them as they come in.', 'Program director, quoted in the original article'],
  ['We have been tracking this for years, and the trend is now hard to ignore.', 'Independent reviewer, quoted in the original article'],
  ['Nobody here thinks this settles the question, but it changes the conversation.', 'Local official, quoted in the original article'],
] as const

const LIMITING_FACTORS = [
  'The figures come from the organizations involved and have not been checked independently yet.',
  'The effect is limited to one region so far.',
  'Similar announcements in the past were scaled back before they took effect.',
]

const DURABILITY = [
  'Durability: the change is written into budgets or law, so it is likely to last.',
  'Durability: the long-term effect depends on follow-up decisions that have not been made yet.',
]

const SOURCE_NOTE = 'This article is invented for local development and describes no real event.'

/** How far the pipeline got with a story: no model call, the screening only, or the full assessment. */
function analysisDepth(story: StorySeed): 'none' | 'screened' | 'assessed' {
  if (story.status === 'fetched' || story.reason === 'paywall') return 'none'
  if (story.status === 'pre_analyzed' || story.reason === 'assess_threshold') return 'screened'
  return 'assessed'
}

const pick = <T>(list: readonly T[], index: number): T => list[index % list.length]!

function screening(story: StorySeed, index: number) {
  return {
    issueId: issueId(story.issue),
    relevancePre: Math.min(10, Math.max(1, story.relevance + (index % 3) - 1)),
    emotionTag: story.emotion,
  }
}

function assessment(story: StorySeed, index: number) {
  const [quote, quoteAttribution] = pick(QUOTES, index)
  return {
    relevance: story.relevance,
    title: story.title,
    titleLabel: story.label,
    summary: `${story.gist} ${pick(SUMMARY_ENDINGS, index)}`,
    quote,
    quoteAttribution,
    marketingBlurb: `${feedTitle(story.feed)} reports: ${story.title}.`,
    relevanceSummary: story.why,
    relevanceReasons: [`Scale: ${story.why}`, pick(DURABILITY, index)].join('\n'),
    antifactors: pick(LIMITING_FACTORS, index),
    relevanceCalculation: [`Impact before limiting factors: ${story.relevance + 1}`, 'Limiting factors: -1', `Final rating: ${story.relevance}`].join('\n'),
  }
}

export interface SyntheticStory {
  seed: StorySeed
  row: Prisma.StoryCreateManyInput & { id: string; sourceUrl: string }
  /** Hours before `now` the story was published (null: never published). */
  publishedHoursAgo: number | null
}

function buildStory(story: StorySeed, index: number, now: Date): SyntheticStory {
  const crawledHoursAgo = 4 + index * 12
  const depth = analysisDepth(story)
  const published = story.status === 'published'
  const paywalled = story.reason === 'paywall'
  const publishedHoursAgo = published ? crawledHoursAgo - 3 : null
  const row = {
    id: storyId(story.key),
    sourceUrl: `${SYNTHETIC_ORIGIN}/${story.feed}/${slugify(story.title)}`,
    sourceTitle: story.title,
    sourceContent: `${story.gist} ${story.why} ${SOURCE_NOTE}`,
    sourceDatePublished: hoursBefore(now, crawledHoursAgo + 2),
    feedId: feedId(story.feed),
    status: story.status,
    rejectionReason: story.reason ?? null,
    dateCrawled: hoursBefore(now, crawledHoursAgo),
    crawlMethod: paywalled ? 'teaser' : 'readability',
    accessTier: paywalled ? 'locked' : 'free',
    ...(depth !== 'none' && screening(story, index)),
    ...(depth === 'assessed' && assessment(story, index)),
    ...(publishedHoursAgo !== null && { slug: slugify(story.title), datePublished: hoursBefore(now, publishedHoursAgo) }),
  }
  return { seed: story, row, publishedHoursAgo }
}

// ──── Newsletters and podcasts ────────────────────────────────────────────

const NEWSLETTER_INTRO = 'This is a synthetic issue for local development. Every story in it is made up, and so are the places and organizations in them.'

function newsletterStoryBlock(story: SyntheticStory, siteUrl: string): string {
  const meta = [
    `{feed:${story.row.feedId}} ${feedTitle(story.seed.feed)}`,
    `[original article](${story.row.sourceUrl})`,
    `[relevance analysis](${siteUrl}/stories/${story.row.slug})`,
  ]
  return `${storyHeading(story.seed.title, story.row.id)}\n${meta.join(' · ')}\n\n${story.seed.why}`
}

/** The stored markdown of an issue, in the generator's format (`newsletterContent.ts`): sections per top-level issue. */
function newsletterContent(stories: SyntheticStory[], siteUrl: string): string {
  const sections = TOP_LEVEL_ISSUES.map(issue => ({ issue, stories: stories.filter(s => topLevelOf(s.seed.issue) === issue.slug) }))
    .filter(section => section.stories.length > 0)
    .map(({ issue, stories }) => [`# ${issue.name} {${issue.slug}}`, ...stories.map(s => newsletterStoryBlock(s, siteUrl))].join('\n\n'))
  return [NEWSLETTER_INTRO, ...sections].join('\n\n---\n\n')
}

const weekTitle = (date: Date) => `Week ${isoWeek(date).week}, ${isoWeek(date).year}`

/** `slot` names the issue's place in the data set ("last-week"), so its id stays the same whatever week the seed runs in. */
function publishedNewsletter(slot: string, stories: SyntheticStory[], publishedAt: Date, siteUrl: string): Prisma.NewsletterCreateManyInput {
  const title = weekTitle(publishedAt)
  const ids = stories.map(s => s.row.id)
  return {
    id: syntheticId(`newsletter:${slot}`),
    title,
    content: newsletterContent(stories, siteUrl),
    storyIds: ids,
    selectedStoryIds: ids,
    status: 'published',
    slug: newsletterSlugBase(title),
    publishedAt,
    createdAt: new Date(publishedAt.getTime() - DAY_MS),
  }
}

function episodeSnapshot(story: SyntheticStory, ref: number) {
  return {
    ref,
    id: story.row.id,
    title: story.seed.title,
    publisher: feedTitle(story.seed.feed),
    sourceUrl: story.row.sourceUrl,
    slug: story.row.slug,
    issue: ISSUE_NAME.get(story.seed.issue)!,
  }
}

/**
 * A two-speaker dialogue in the stored shape (`podcastDialogueSchema`): HOST_A says what happened,
 * HOST_B why it matters. The intro leads into the first story, so its segment opens with HOST_B.
 */
function episodeDialogue(stories: SyntheticStory[], title: string) {
  return {
    episodeTitle: title,
    episodeSummary: 'A synthetic episode for local development. Every story in it is made up.',
    segments: [
      {
        kind: 'intro',
        storyRef: null,
        turns: [{ speaker: 'HOST_A', text: `Welcome to a made-up week of Actually Relevant. We start with this: ${stories[0]!.seed.gist}` }],
      },
      ...stories.map((story, i) => ({
        kind: 'story',
        storyRef: i + 1,
        turns: [...(i > 0 ? [{ speaker: 'HOST_A', text: `Next: ${story.seed.gist}` }] : []), { speaker: 'HOST_B', text: story.seed.why }],
      })),
      { kind: 'outro', storyRef: null, turns: [{ speaker: 'HOST_A', text: 'None of these stories happened, but the shape of the episode is the real one.' }] },
    ],
  }
}

/** `slot` as for newsletters: the episode's id does not follow the week. */
function episodeBase(slot: string, stories: SyntheticStory[], weekKey: string, selectedAt: Date) {
  return {
    id: syntheticId(`podcast:${slot}`),
    storyIds: stories.map(s => s.row.id),
    weekKey,
    kind: 'weekly' as const,
    episodeStories: stories.map((s, i) => episodeSnapshot(s, i + 1)),
    storiesSelectedAt: selectedAt,
    createdAt: selectedAt,
  }
}

function publishedEpisode(slot: string, stories: SyntheticStory[], publishedAt: Date): Prisma.PodcastCreateManyInput {
  const { key: weekKey } = isoWeek(publishedAt)
  const title = `${stories.map(s => s.seed.label).join(', ')} (synthetic)`
  const dialogue = episodeDialogue(stories, title)
  const turns = dialogue.segments.flatMap(segment => segment.turns)
  return {
    ...episodeBase(slot, stories, weekKey, new Date(publishedAt.getTime() - DAY_MS)),
    title,
    script: turns.map(t => `${t.speaker.replace('_', ' ')}: ${t.text}`).join('\n\n'),
    status: 'published',
    stage: 'ready',
    mode: 'automated',
    dialogue,
    episodeSummary: dialogue.episodeSummary,
    // No audio exists: the player shows the episode but cannot play it
    audioUrl: `${SYNTHETIC_ORIGIN}/podcast/${weekKey}.mp3`,
    audioBytes: 5_760_000,
    durationSec: 720,
    readyAt: new Date(publishedAt.getTime() - 8 * HOUR_MS),
    publishedAt,
  }
}

// ──── The data set ────────────────────────────────────────────────────────

export interface SyntheticDataset {
  issues: Prisma.IssueCreateManyInput[]
  childIssues: Prisma.IssueCreateManyInput[]
  feeds: Prisma.FeedCreateManyInput[]
  stories: SyntheticStory[]
  cluster: { id: string; primaryStoryId: string; memberIds: string[] }
  newsletters: Prisma.NewsletterCreateManyInput[]
  podcasts: Prisma.PodcastCreateManyInput[]
}

/** Every row of the data set, dated back from `now`; `siteUrl` is the site the newsletter links point at. */
export function buildSyntheticDataset(now: Date, siteUrl: string): SyntheticDataset {
  const stories = STORIES.map((story, index) => buildStory(story, index, now))
  const published = stories.filter(s => s.publishedHoursAgo !== null)
  const publishedBetween = (fromHours: number, toHours: number) => published.filter(s => s.publishedHoursAgo! > fromHours && s.publishedHoursAgo! <= toHours)
  const lastWeek = publishedBetween(WEEK_HOURS, 2 * WEEK_HOURS).slice(0, 5)
  const weekBefore = publishedBetween(2 * WEEK_HOURS, Infinity).slice(0, 5)
  const newest = published.slice(0, 8)
  const thisWeek = isoWeek(now).key

  return {
    issues: TOP_LEVEL_ISSUES.map(topLevelIssueRow),
    childIssues: CHILD_ISSUES.map(childIssueRow),
    feeds: FEEDS.map(feed => feedRow(feed, now)),
    stories,
    cluster: { id: syntheticId('cluster:wendrake-tidal-barrier'), primaryStoryId: storyId(CLUSTER.primary), memberIds: CLUSTER.members.map(storyId) },
    newsletters: [
      publishedNewsletter('two-weeks-ago', weekBefore, hoursBefore(now, 2 * WEEK_HOURS), siteUrl),
      publishedNewsletter('last-week', lastWeek, hoursBefore(now, WEEK_HOURS), siteUrl),
      // This week's issue, assigned and shortlisted but not generated yet
      {
        id: syntheticId('newsletter:this-week'),
        title: weekTitle(now),
        storyIds: newest.map(s => s.row.id),
        selectedStoryIds: newest.slice(0, 3).map(s => s.row.id),
        createdAt: hoursBefore(now, 1),
      },
    ],
    podcasts: [
      publishedEpisode('two-weeks-ago', weekBefore.slice(0, 4), hoursBefore(now, 2 * WEEK_HOURS)),
      publishedEpisode('last-week', lastWeek.slice(0, 4), hoursBefore(now, WEEK_HOURS)),
      // This week's episode, stopped for review after its stories were selected. A dry run, as a
      // development server makes its episodes: continuing it uses the silent stub voice, never ElevenLabs
      {
        ...episodeBase('this-week', newest.slice(0, 4), thisWeek, hoursBefore(now, 1)),
        title: `Actually Relevant, ${thisWeek}`,
        stage: 'selected',
        mode: 'interactive',
        dryRun: true,
      },
    ],
  }
}

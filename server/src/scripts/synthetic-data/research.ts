/**
 * Researched versions of a few synthetic published stories (`.context/story-research.md`, "Reader
 * format"), so the story page's researched format can be checked locally. Each is built with the real
 * projection (`buildResearchedStory`) from an invented run: the original article, two invented
 * outlets on the synthetic origin and one earlier synthetic story. The row takes the swap as an
 * applied run leaves it: the single-source fields in `preResearch`, `relevanceSummary` null.
 */
import type { Prisma } from '@prisma/client'
import { buildResearchedStory } from '../../services/researchedStory.js'
import type { ResearchSource } from '../../services/researchPipeline.js'

/** What the researched version is written from: a synthetic story's texts and where it was found. */
export interface ResearchedSeed {
  title: string
  gist: string
  why: string
  sourceUrl: string
  outlet: string
  /** YYYY-MM-DD */
  date: string
  earlier: { id: string; title: string; slug: string; date: string }
}

/** The single-source fields an applied run replaces (the plan's swap), as the snapshot keeps them. */
const SWAPPED_FIELDS = [
  'title',
  'titleLabel',
  'summary',
  'quote',
  'quoteAttribution',
  'marketingBlurb',
  'relevanceReasons',
  'antifactors',
  'relevance',
  'relevanceCalculation',
  'relevanceSummary',
] as const

const COVERAGE = [
  { key: 'S1', outlet: 'Coastline Ledger', kind: 'news-report', country: 'Portugal' },
  { key: 'S2', outlet: 'Harbor Policy Review', kind: 'analysis', country: 'Canada' },
] as const

function source(
  id: string,
  origin: ResearchSource['origin'],
  fields: Pick<ResearchSource, 'url' | 'title' | 'outlet' | 'date' | 'kind' | 'country'>,
  sentence: string,
): ResearchSource {
  return {
    id,
    origin,
    ...fields,
    favicon: null,
    usedRawContent: false,
    relation: 'same-development',
    facts: [{ id: `${id}F1`, statement: sentence, supportingSentence: sentence, measures: '', found: true }],
    voices: [],
  }
}

/** The fields to merge into a published synthetic story's row so it reads as researched. */
export function researchedRow(row: Prisma.StoryCreateManyInput, seed: ResearchedSeed, origin: string): Partial<Prisma.StoryCreateManyInput> {
  const sources = [
    source(
      'S0',
      'original',
      { url: seed.sourceUrl, title: seed.title, outlet: seed.outlet, date: seed.date, kind: 'news-report', country: 'unknown' },
      seed.gist,
    ),
    ...COVERAGE.map((c, i) =>
      source(
        c.key,
        'search',
        {
          url: `${origin}/coverage/${c.key.toLowerCase()}-${seed.earlier.slug}`,
          title: `${c.outlet} on: ${seed.title}`,
          outlet: c.outlet,
          date: seed.date,
          kind: c.kind,
          country: c.country,
        },
        i === 0 ? `Local officials confirmed the figures reported by ${seed.outlet}.` : seed.why,
      ),
    ),
  ]
  const research = buildResearchedStory({
    sources,
    earlier: [
      {
        id: 'E1',
        storyId: seed.earlier.id,
        slug: seed.earlier.slug,
        title: seed.earlier.title,
        date: seed.earlier.date,
        relation: 'background',
        facts: [{ id: 'E1F1', statement: seed.earlier.title, supportingSentence: seed.earlier.title, measures: '', found: true }],
      },
    ],
    draft: {
      story: [
        {
          sentences: [
            { text: seed.gist, factIds: ['S0F1'] },
            { text: `Local officials confirmed the figures, ${COVERAGE[0].outlet} reports.`, factIds: ['S1F1'] },
          ],
        },
        { sentences: [{ text: `It follows an earlier development: ${seed.earlier.title}.`, factIds: ['E1F1'] }] },
      ],
      whyThisMatters: [
        { text: seed.why, factIds: ['S2F1'] },
        { text: 'If it holds, the approach could be copied by other regions facing the same problem.', factIds: [] },
      ],
      caveats: [{ text: 'The sources count the effect over different periods, so the figures are not directly comparable.', factIds: ['S0F1', 'S2F1'] }],
      quoteSourceId: 'S1',
    },
  })
  const preResearch = Object.fromEntries(SWAPPED_FIELDS.map(field => [field, row[field] ?? null]))
  return { research, preResearch, relevanceSummary: null }
}

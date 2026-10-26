/**
 * Pins the prompts production sends, byte for byte, built from fixed rows through each service's
 * own code path (database and model mocked). The snapshots were written from the services before
 * their prompt-input shaping moved into `promptInputs.ts`, so a refactor of that shaping that
 * changes a prompt fails here. The eval harness builds its inputs with the same builders
 * (`.context/model-eval.md`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  story: { findUnique: vi.fn(), findMany: vi.fn() },
  blueskyPost: { findFirst: vi.fn() },
  mastodonPost: { findFirst: vi.fn() },
  $queryRaw: vi.fn(),
}))

/** Every prompt a model was sent, in order. The model answers with `answers`, then fails. */
const sent = vi.hoisted(() => ({ prompts: [] as string[], answers: [] as unknown[] }))
const STOP = 'stop after the prompt'

vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))
vi.mock('./llm.js', () => {
  const llm = () => ({
    withStructuredOutput: () => ({
      invoke: async (messages: { content: unknown }[]) => {
        sent.prompts.push(String(messages[0]!.content))
        if (sent.answers.length > 0) return sent.answers.shift()
        throw new Error(STOP)
      },
    }),
  })
  return { getLLMByTier: llm, getSmallLLM: llm, getMediumLLM: llm, getLargeLLM: llm, rateLimitDelay: async () => undefined }
})
vi.mock('./embedding.js', () => ({ generateEmbeddingForContent: vi.fn() }))
vi.mock('./dedup.js', () => ({ detectAndCluster: vi.fn() }))
vi.mock('./storyLifecycle.js', async importOriginal => ({
  ...(await importOriginal<typeof import('./storyLifecycle.js')>()),
  transition: vi.fn(async (ids: string[]) => ({ moved: ids, skipped: [] })),
}))

const { assessStory, selectStories } = await import('./analysis.js')
const { getRelatedStories } = await import('./relatedStories.js')
const { pickBestStoryForSocial } = await import('./socialMedia.js')
const bluesky = await import('./bluesky.js')
const mastodon = await import('./mastodon.js')
const { pickShortlist, buildContent } = await import('./newsletter.js')
const { selectEpisodeStories, writeEpisodeScript, loadEpisodeStories } = await import('./podcastScript.js')

/** The prompts sent while `run` ran; a model failure after the last prompt is expected. */
async function promptsOf(run: () => Promise<unknown>): Promise<string[]> {
  sent.prompts = []
  await run().catch(err => {
    if (!(err instanceof Error) || err.message !== STOP) throw err
  })
  return sent.prompts
}

const guidelines = (name: string) => ({
  promptFactors: `${name} factors: people & <places>`,
  promptAntifactors: `${name} antifactors`,
  promptRatings: `${name} ratings`,
})

const parentIssue = { name: 'Planet & Climate', slug: 'planet-climate', parentId: null, parent: null }
const childIssue = { name: 'Oceans', slug: 'oceans', parentId: 'issue-p', parent: { name: 'Human Development', slug: 'human-development' } }
const otherIssue = { name: 'Science & Technology', slug: 'science-technology', parentId: null, parent: null }

beforeEach(() => {
  vi.clearAllMocks()
  sent.answers = []
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-20T08:00:00Z'))
  vi.spyOn(Math, 'random').mockReturnValue(0.5)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('analysis prompts', () => {
  const story = (issue: ReturnType<typeof guidelines> | null) => ({
    id: 'story-1',
    status: 'pre_analyzed',
    sourceTitle: 'Reef "recovers" after <ban>',
    sourceContent: `Fishing ban & reef. ${'Long body. '.repeat(500)}`,
    sourceUrl: 'https://news.example/reef?a=1&b=2',
    issue,
    feed: { title: 'Ocean Daily', displayTitle: 'Ocean Daily (display)', issue: guidelines('Feed issue') },
  })

  it('assessStory takes the story issue guidelines and the feed title as publisher', async () => {
    mockPrisma.story.findUnique.mockResolvedValue(story(guidelines('Story issue')))
    expect(await promptsOf(() => assessStory('story-1'))).toMatchSnapshot()
  })

  it('assessStory falls back to the feed issue guidelines', async () => {
    mockPrisma.story.findUnique.mockResolvedValue(story(null))
    expect(await promptsOf(() => assessStory('story-1'))).toMatchSnapshot()
  })

  it('selectStories sends the primary and unclustered stories with their dates', async () => {
    const row = (n: number, extra: Record<string, unknown>) => ({
      id: `story-${n}`,
      title: `Title ${n}`,
      summary: n === 3 ? null : `Summary ${n}`,
      relevanceReasons: `Reasons ${n}`,
      antifactors: n === 2 ? null : `Limits ${n}`,
      relevanceCalculation: `Calc ${n}`,
      emotionTag: n === 1 ? null : 'hopeful',
      relevance: 6,
      sourceDatePublished: n === 1 ? null : new Date(`2026-10-1${n}T06:00:00Z`),
      cluster: null,
      ...extra,
    })
    mockPrisma.story.findMany.mockResolvedValue([
      row(1, {}),
      row(2, { cluster: { primaryStoryId: 'story-2' } }),
      row(3, {}),
      row(4, { cluster: { primaryStoryId: 'story-2' } }),
    ])
    expect(await promptsOf(() => selectStories(['story-1', 'story-2', 'story-3', 'story-4']))).toMatchSnapshot()
  })
})

describe('related stories prompt', () => {
  it('sends the source and the cosine candidates', async () => {
    const candidates = Array.from({ length: 12 }, (_, i) => ({
      id: `cand-${i + 1}`,
      title: i === 5 ? null : `Candidate ${i + 1} & co`,
      title_label: i % 3 === 0 ? null : `Label ${i + 1}`,
    }))
    mockPrisma.$queryRaw.mockResolvedValueOnce([{ id: 'src', title: 'Source <title>', title_label: null }]).mockResolvedValueOnce(candidates)
    mockPrisma.story.findMany.mockResolvedValue([])
    expect(await promptsOf(() => getRelatedStories('source-slug'))).toMatchSnapshot()
  })
})

describe('social prompts', () => {
  it('pickBestStoryForSocial sends each candidate with its fallbacks', async () => {
    mockPrisma.story.findMany.mockResolvedValue([
      {
        id: 'story-1',
        title: null,
        sourceTitle: 'Source title 1',
        titleLabel: null,
        summary: null,
        relevanceSummary: null,
        relevance: null,
        emotionTag: null,
        issue: null,
        datePublished: null,
      },
      {
        id: 'story-2',
        title: 'Title 2',
        sourceTitle: 'Source title 2',
        titleLabel: 'Label 2',
        summary: 'Summary 2',
        relevanceSummary: 'Why 2',
        relevance: 7,
        emotionTag: 'surprising',
        issue: { name: 'Planet & Climate' },
        datePublished: new Date('2026-10-19T10:00:00Z'),
      },
    ])
    expect(await promptsOf(() => pickBestStoryForSocial(['story-1', 'story-2']))).toMatchSnapshot()
  })

  const draftStory = (titleLabel: string | null, displayTitle: string | null) => ({
    id: 'story-1',
    title: 'Reef recovers',
    titleLabel,
    summary: 'A fishing ban let a reef recover.',
    relevanceSummary: 'Shows bans work.',
    emotionTag: 'hopeful',
    sourceUrl: 'https://news.example/reef',
    slug: 'reef-recovers',
    issue: { name: 'Planet & Climate' },
    feed: { title: 'Ocean Daily', displayTitle },
  })

  it('bluesky generateDraft sends the story with its blurb budget', async () => {
    mockPrisma.blueskyPost.findFirst.mockResolvedValue(null)
    mockPrisma.story.findUnique.mockResolvedValue(draftStory(null, 'Ocean Daily (display)'))
    expect(await promptsOf(() => bluesky.generateDraft('story-1'))).toMatchSnapshot()
  })

  it('mastodon generateDraft sends the story with its blurb budget', async () => {
    mockPrisma.mastodonPost.findFirst.mockResolvedValue(null)
    mockPrisma.story.findUnique.mockResolvedValue(draftStory('Label', null))
    expect(await promptsOf(() => mastodon.generateDraft('story-1'))).toMatchSnapshot()
  })
})

describe('newsletter prompts', () => {
  const row = (n: number, issue: object | null, feedIssue: object | null, extra: Record<string, unknown> = {}) => ({
    id: `story-${n}`,
    title: n === 2 ? null : `Title ${n}`,
    sourceTitle: `Source title ${n}`,
    sourceUrl: `https://news.example/${n}`,
    slug: `title-${n}`,
    summary: n === 3 ? null : `Summary ${n}`,
    relevanceSummary: `Why ${n}`,
    marketingBlurb: n === 4 ? null : `Blurb ${n}`,
    quote: null,
    quoteAttribution: null,
    emotionTag: n === 1 ? null : 'calm',
    sourceDatePublished: null,
    dateCrawled: new Date(`2026-10-1${n}T06:00:00Z`),
    issue,
    feed: { id: `feed-${n}`, title: `Feed ${n}`, displayTitle: null, issue: feedIssue },
    ...extra,
  })
  const rows = [row(1, otherIssue, null), row(2, childIssue, null), row(3, null, parentIssue), row(4, null, null), row(5, parentIssue, otherIssue)]

  it('pickShortlist sends the longlist with each story top-level issue', async () => {
    mockPrisma.story.findMany.mockResolvedValue(rows)
    expect(await promptsOf(() => pickShortlist({ id: 'nl-1', storyIds: rows.map(r => r.id) }))).toMatchSnapshot()
  })

  it('buildContent sends no prompt: the content is the template alone, with no intro', async () => {
    mockPrisma.story.findMany.mockResolvedValue(rows)
    let content = ''
    expect(
      await promptsOf(async () => {
        content = await buildContent({ id: 'nl-1', selectedStoryIds: rows.map(r => r.id) })
      }),
    ).toEqual([])
    // The first line is the first issue's section header
    expect(content.startsWith('# ')).toBe(true)
  })
})

describe('podcast prompts', () => {
  const pool = [1, 2, 3, 4, 5, 6].map(n => ({
    id: `story-${n}`,
    title: n === 2 ? null : `Headline ${n}`,
    sourceTitle: `Source title ${n}`,
    sourceUrl: `https://news.example/${n}`,
    slug: `headline-${n}`,
    summary: n === 3 ? null : `Summary ${n}`,
    relevanceSummary: n === 4 ? null : `Why ${n} matters`,
    relevanceReasons: n === 5 ? null : `Reasons ${n}`,
    antifactors: n === 6 ? null : `Limits ${n}`,
    relevance: n === 6 ? null : 9 - n,
    emotionTag: n === 1 ? null : 'calm',
    issue: n === 3 ? null : { name: `Issue ${n % 3}`, parent: n === 4 ? { name: 'Parent issue' } : null },
    feed: { title: `Publisher ${n}`, displayTitle: n === 1 ? 'Display 1' : null, issue: { name: 'Feed issue', parent: null } },
  }))

  it('selects from the pool and scripts the chosen stories', async () => {
    mockPrisma.story.findMany.mockResolvedValue(pool)
    sent.answers = [{ raw: {}, parsed: { selectedIds: ['story-6', 'story-2', 'story-3', 'story-4', 'story-5'] } }]
    const prompts = await promptsOf(async () => writeEpisodeScript(await selectEpisodeStories(new Date('2026-10-20T00:00:00Z')), 'weekly'))
    expect(prompts).toHaveLength(2)
    expect(prompts).toMatchSnapshot()
  })

  it('scripts frozen snapshots with the stories as they are now', async () => {
    mockPrisma.story.findMany.mockResolvedValue(pool)
    const snapshots = pool.slice(0, 4).map((s, i) => ({
      ref: i + 1,
      id: s.id,
      title: `Frozen ${i + 1}`,
      publisher: `Frozen publisher ${i + 1}`,
      sourceUrl: s.sourceUrl,
      slug: s.slug,
      issue: `Frozen issue ${i + 1}`,
    }))
    expect(await promptsOf(async () => writeEpisodeScript(await loadEpisodeStories(snapshots), 'weekly'))).toMatchSnapshot()
  })
})

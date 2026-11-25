import { describe, expect, it } from 'vitest'
import { config } from '../../../config.js'
import type { KeyFile } from './keyFiles.js'
import type { AnswerKey } from './keySchema.js'
import { linkReplayStories } from './link.js'
import { addDays, lastReplayDay } from './replay.js'
import { estimateReplay, expectedReviews } from './replayEstimate.js'

/** The schedule the cases below are written against, whatever the config holds today. */
const SCHEDULE = { ...config.overviews, quietAfterDays: 21, fadeAfterDays: 120, reviewAt: [3, 6, 12, 25, 50], reviewEveryDays: 30 }

const daily = (from: string, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i))

describe('expectedReviews', () => {
  it('reviews a development each time its entries reach 3, 6 and 12, and never one of 1 or 2 entries', () => {
    expect(expectedReviews(daily('2026-05-01', 12), '2026-05-12', SCHEDULE)).toEqual([
      { day: '2026-05-03', entries: 3 },
      { day: '2026-05-06', entries: 6 },
      { day: '2026-05-12', entries: 12 },
    ])
    expect(expectedReviews(['2026-05-01'], '2026-12-31', SCHEDULE)).toEqual([])
    // Two entries stay forming, never public: no count reached, no periodic review
    expect(expectedReviews(['2026-05-02', '2026-05-01'], '2026-12-31', SCHEDULE)).toEqual([])
  })

  it('reviews a public development again every 30 days after its last review, quiet or not', () => {
    expect(expectedReviews(daily('2026-05-01', 3), '2026-06-30', SCHEDULE)).toEqual([
      { day: '2026-05-03', entries: 3 },
      { day: '2026-06-02', entries: 3 },
    ])
  })

  it('reviews none once it has faded 120 days after its last entry, until a late entry reopens it', () => {
    const faded = expectedReviews(daily('2026-05-01', 3), '2026-12-31', SCHEDULE)
    // It fades on 2026-08-31, the night its fifth review would have fallen due
    expect(faded.map(r => r.day)).toEqual(['2026-05-03', '2026-06-02', '2026-07-02', '2026-08-01'])
    const reopened = expectedReviews([...daily('2026-05-01', 3), '2026-10-15'], '2026-12-31', SCHEDULE)
    expect(reopened).toEqual([...faded, { day: '2026-10-15', entries: 4 }, { day: '2026-11-14', entries: 4 }, { day: '2026-12-14', entries: 4 }])
  })

  it('reviews it on a night when more of that day’s stories join than the burst limit, and not at the limit', () => {
    // 12 entries a day apart, then 6 on one day (18, no count reached) and 5 on another (23)
    const days = [...daily('2026-05-01', 12), ...Array.from({ length: 6 }, () => '2026-05-14'), ...Array.from({ length: 5 }, () => '2026-05-16')]
    expect(expectedReviews(days, '2026-05-16', { ...SCHEDULE, burstLimit: 5 })).toEqual([
      { day: '2026-05-03', entries: 3 },
      { day: '2026-05-06', entries: 6 },
      { day: '2026-05-12', entries: 12 },
      { day: '2026-05-14', entries: 18 },
    ])
  })
})

describe('estimateReplay', () => {
  type Entry = AnswerKey['entries'][number]
  const entry = (slug: string, date: string): Entry => ({
    slug,
    date,
    title: `Title of ${slug}`,
    join: 'must',
    role: 'routine',
    kind: null,
    eitherRole: false,
    roleReview: null,
    values: [],
    statuses: [],
    why: 'belongs',
  })
  const key = (id: string, entries: Entry[], nearMisses: AnswerKey['nearMisses'] = []): AnswerKey => ({
    schemaVersion: 1,
    id,
    title: id,
    charter: { in: 'In.', out: [], endEvent: null },
    figures: [],
    entries,
    nearMisses,
    responses: [],
    centers: [],
    notes: '',
  })
  // The judged Ebola key, its near miss n1 an entry of the war's key in the other half: the war's other entries are the background
  const EBOLA = key(
    'ebola-drc-2026',
    ['2026-05-01', '2026-05-03', '2026-05-05', '2026-05-07', '2026-05-09', '2026-05-11'].map((d, i) => entry(`e${i + 1}`, d)),
    [{ slug: 'n1', date: '2026-05-04', title: 'Title of n1', why: 'same province' }],
  )
  const WAR = key('iran-war-2026', [entry('n1', '2026-05-04'), entry('w1', '2026-05-02'), entry('w2', '2026-05-06'), entry('w3', '2026-05-08')])
  const FILES: KeyFile[] = [EBOLA, WAR].map(k => ({ file: `${k.id}.json`, key: k, errors: [] }))
  const set = linkReplayStories(FILES, 'judge')

  it("counts the half's stories and the background's apart, and gives each development the reviews of its entries among them", () => {
    const e = estimateReplay(set, { repeat: 1 })
    expect(e.stories).toEqual({ judged: 7, background: 3 })
    const end = lastReplayDay('2026-05-11')
    expect(e.end).toBe(end)
    expect(e.developments.map(d => [d.key, d.background, d.entries, d.reviews])).toEqual([
      [
        'ebola-drc-2026',
        false,
        6,
        expectedReviews(
          EBOLA.entries.map(x => x.date),
          end,
        ).length,
      ],
      [
        'iran-war-2026',
        true,
        4,
        expectedReviews(
          WAR.entries.map(x => x.date),
          end,
        ).length,
      ],
    ])
  })

  it('replays with --limit the first stories by date across the half and the background, and ends its days after the last of them', () => {
    const e = estimateReplay(set, { repeat: 1, limit: 6 })
    // e1, w1, e2, n1, e3, w2
    expect(e.stories).toEqual({ judged: 4, background: 2 })
    expect(e.end).toBe(lastReplayDay('2026-05-06'))
    expect(e.developments.map(d => [d.key, d.entries])).toEqual([
      ['ebola-drc-2026', 3],
      ['iran-war-2026', 3],
    ])
  })
})

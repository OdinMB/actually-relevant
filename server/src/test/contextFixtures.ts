/**
 * Story context's in-memory shapes for unit tests (the eval's scores, judges and fact sample): a
 * context fact, a box of sentences, a pipeline result and a gap key, each with defaults a test
 * overrides. The database fixtures are `test/db/storyContext.ts`.
 */
import type { GapKey } from '../scripts/eval/overviews/gapKeySchema.js'
import type { ContextFactData, DraftBox } from '../services/storyContextChecks.js'
import type { ContextInput, StoryContextResult } from '../services/storyContextPipeline.js'

const sourceId = (ref: string) => ref.replace(/F\d+$/, '')

export function contextFact(ref: string, extra: Partial<ContextFactData> = {}): ContextFactData {
  return {
    ref,
    origin: 'research',
    reusedFromId: null,
    slot: null,
    source: { id: sourceId(ref), url: `https://example.com/${sourceId(ref)}`, outlet: 'Outlet', title: 'Title', date: '2026-11-10', kind: 'news-report' },
    supportingSentence: `Sentence of ${ref}.`,
    passage: null,
    supportFound: true,
    statement: `Statement of ${ref}.`,
    value: 100,
    valueHigh: null,
    unit: 'people',
    approx: 'exact',
    provisional: false,
    counted: 'people evacuated',
    place: 'Indonesia',
    asOf: '2026-11-10',
    credited: '',
    creditedKind: null,
    validity: 'fixed',
    verdict: 'supported',
    verdictProblem: null,
    model: 'gpt-6-luna',
    promptVersion: 'abcd1234',
    ...extra,
  }
}

export const sentenceBox = (type: DraftBox['type'], factIds: string[], extra: Partial<DraftBox> = {}): DraftBox => ({
  type,
  heading: 'Heading',
  teaser: 'Teaser',
  place: null,
  sentences: [{ text: 'A sentence.', factIds }],
  visual: null,
  ...extra,
})

export function contextResult(extra: Partial<StoryContextResult> = {}, record: Partial<StoryContextResult['record']> = {}): StoryContextResult {
  return {
    status: 'completed',
    outcome: 'built',
    facts: [],
    boxes: [],
    writer: null,
    credits: 0,
    modelUsd: 0,
    error: null,
    transient: false,
    ...extra,
    record: {
      slots: [],
      responseInStory: null,
      responseFallback: false,
      searches: [],
      sourceDrops: [],
      extractionDrops: [],
      facts: { research: 0, leftOut: 0, search: 0, reused: 0, supported: 0, rejected: 0, unjudged: 0 },
      droppedFacts: [],
      boxDrops: [],
      numberHints: [],
      responseNotFound: false,
      tally: { checked: 0, failed: 0 },
      calls: [],
      optOutChecked: false,
      ...record,
    },
  }
}

export function contextInput(extra: Partial<ContextInput> = {}): ContextInput {
  return {
    storyId: 'story-1',
    title: 'Story A',
    summary: 'Summary.',
    storyDay: '2026-11-14',
    layout: {
      paragraphs: [{ id: 'P1', text: 'Fires burned 2.88 million hectares.', sourceUrls: ['https://example.com/S0'] }],
      points: [{ id: 'W1', text: 'Smoke reaches millions.', sourceUrls: ['https://example.com/S0'] }],
      caveats: ['Figures are provisional.'],
    },
    researchRunId: 'run-1',
    sources: [
      {
        id: 'S0',
        url: 'https://example.com/S0',
        title: 'Title',
        outlet: 'Outlet',
        date: '2026-11-13',
        kind: 'news-report',
        facts: [
          {
            id: 'S0F1',
            statement: 'Fires burned 2.88 million hectares.',
            supportingSentence: 'Fires burned 2.88 million hectares.',
            measures: 'area burned',
            found: true,
          },
        ],
        voices: [],
      },
    ],
    reusable: [],
    ...extra,
  }
}

export function gapKey(extra: Partial<GapKey> = {}): GapKey {
  return {
    schemaVersion: 1,
    slug: 'story-a',
    title: 'Story A',
    date: '2026-11-14',
    needs: [
      { id: 'record', slot: 'compared', need: 'n', kind: 'figure', importance: 'must', inStory: null, accepts: 'a', example: { value: 'v', source: 's' } },
      { id: 'stated', slot: 'who_affected', need: 'n', kind: 'figure', importance: 'must', inStory: 'our words', accepts: 'a', example: null },
      { id: 'term', slot: 'key_term', need: 'n', kind: 'term', importance: 'nice', inStory: null, accepts: 'a', example: null },
      { id: 'response', slot: 'response', need: 'n', kind: 'fact', importance: 'must', inStory: null, accepts: 'a', example: { value: 'v', source: 's' } },
    ],
    notNeeded: [{ slot: 'next', why: 'w' }],
    notes: '',
    ...extra,
  }
}

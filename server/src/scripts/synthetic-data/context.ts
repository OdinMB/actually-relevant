/**
 * Story context for one researched synthetic story (`.context/story-context.md`), so the story page's
 * context cards and the admin's context panel can be checked locally: a finished run, its facts
 * (research's three, structured, and six from two invented sources a second search found) and one
 * box of each kind the page draws: the figures tiles, a bar chart after a paragraph, a line chart
 * after a Why This Matters point, a card of sentences in the More context section and the honest
 * gap. Written in the shape a run stores, by hand: no model wrote them, and the set shows every card
 * rather than a run that would have written them all.
 */
import type { Prisma } from '@prisma/client'
import type { ResearchSource } from '../../services/researchPipeline.js'
import type { ContextRunRecord } from '../../services/storyContextPipeline.js'
import { config } from '../../config.js'

/** What the context is written from: the researched story and its research sources. */
export interface ContextSeed {
  /** The story's key in the data set, for the rows' stable ids. */
  key: string
  storyId: string
  slug: string
  publishedAt: Date
  sources: ResearchSource[]
}

export interface SyntheticContext {
  run: Prisma.StoryContextRunCreateManyInput
  facts: Prisma.ContextFactCreateManyInput[]
  boxes: Prisma.ContextBoxCreateManyInput[]
}

/** Stands in for the model and prompt version a run records: nothing here was written by one. */
const WRITER = 'synthetic'
const MINUTE_MS = 60_000

type Precision = 'day' | 'month' | 'year'

interface FactSpec {
  ref: string
  source: { url: string; outlet: string; title: string; date: string; kind: string }
  sentence: string
  value?: number
  unit?: string
  approx?: 'exact' | 'about'
  provisional?: boolean
  counted?: string
  asOf?: { date: string; precision: Precision }
  validity: 'fixed' | 'slow' | 'fast'
}

const utcDay = (day: string) => new Date(`${day}T00:00:00Z`)
const daysBefore = (day: string, n: number) => new Date(utcDay(day).getTime() - n * 24 * 60 * MINUTE_MS).toISOString().slice(0, 10)

/** Every row of the story's context, its run finished half an hour after the story was published. */
export function contextRows(seed: ContextSeed, origin: string, idFor: (key: string) => string): SyntheticContext {
  const day = seed.publishedAt.toISOString().slice(0, 10)
  const year = Number(day.slice(0, 4))
  const month = { date: `${day.slice(0, 7)}-01`, precision: 'month' as const }
  const inYear = (y: number) => ({ date: `${y}-01-01`, precision: 'year' as const })
  const runId = idFor(`context-run:${seed.key}`)
  const startedAt = new Date(seed.publishedAt.getTime() + 30 * MINUTE_MS)
  const finishedAt = new Date(startedAt.getTime() + 3 * MINUTE_MS)

  const office = {
    url: `${origin}/varrowen-education-office/school-meals-${seed.slug}`,
    outlet: 'Varrowen Education Office',
    title: 'School meals: the pilot and the permanent program',
    date: daysBefore(day, 2),
    kind: 'official-body',
  }
  const watch = {
    url: `${origin}/plains-budget-watch/lunch-costs-${seed.slug}`,
    outlet: 'Plains Budget Watch',
    title: 'What permanent school lunches will cost Varrowen',
    date: daysBefore(day, 1),
    kind: 'analysis',
  }
  const pupils = { unit: 'pupils', counted: 'pupils getting free school lunches' }
  const attendance = { unit: '%', counted: 'average attendance in pilot schools' }

  // Research's facts, structured: none of them carries a figure
  const research: FactSpec[] = seed.sources.flatMap(s =>
    s.facts.map(f => ({
      ref: f.id,
      source: { url: s.url ?? '', outlet: s.outlet, title: s.title, date: s.date ?? day, kind: s.kind },
      sentence: f.supportingSentence,
      validity: 'fixed' as const,
    })),
  )
  // The second search's: research's sources are S0 to S2, so its own are S3 and S4
  const search: FactSpec[] = [
    {
      ref: 'S3F1',
      source: office,
      sentence: 'The pilot served 180,000 pupils in its first year.',
      value: 180_000,
      ...pupils,
      asOf: inYear(year - 2),
      validity: 'fixed',
    },
    {
      ref: 'S3F2',
      source: office,
      sentence: 'In its second year the pilot reached 240,000 pupils.',
      value: 240_000,
      ...pupils,
      asOf: inYear(year - 1),
      validity: 'fixed',
    },
    {
      ref: 'S3F3',
      source: office,
      sentence: "From the next school year the program covers all 600,000 pupils in the province's public schools.",
      value: 600_000,
      ...pupils,
      asOf: month,
      validity: 'slow',
    },
    {
      ref: 'S3F4',
      source: office,
      sentence: 'Before the pilot, average attendance in the pilot schools was 88%.',
      value: 88,
      ...attendance,
      asOf: inYear(year - 3),
      validity: 'fixed',
    },
    {
      ref: 'S3F5',
      source: office,
      sentence: 'Attendance in the pilot schools rose to 91% in the first year.',
      value: 91,
      ...attendance,
      asOf: inYear(year - 2),
      validity: 'fixed',
    },
    {
      ref: 'S3F6',
      source: office,
      sentence: 'Provisional figures put attendance at 93% in the second year.',
      value: 93,
      ...attendance,
      provisional: true,
      asOf: inYear(year - 1),
      validity: 'fixed',
    },
    {
      ref: 'S4F1',
      source: watch,
      sentence: 'The permanent program will cost about $52 million a year.',
      value: 52_000_000,
      unit: 'USD',
      approx: 'about',
      counted: 'yearly cost of free school lunches in Varrowen',
      asOf: month,
      validity: 'slow',
    },
    { ref: 'S4F2', source: watch, sentence: "The province's budget office will publish the program's first full-year cost next spring.", validity: 'fast' },
  ]

  const fact = (spec: FactSpec, origin: 'research' | 'search'): Prisma.ContextFactCreateManyInput => ({
    id: idFor(`context-fact:${seed.key}:${spec.ref}`),
    storyId: seed.storyId,
    runId,
    ref: spec.ref,
    origin,
    sourceUrl: spec.source.url,
    sourceOutlet: spec.source.outlet,
    sourceTitle: spec.source.title,
    sourceDate: utcDay(spec.source.date),
    sourceKind: spec.source.kind,
    supportingSentence: spec.sentence,
    passage: origin === 'search' ? spec.sentence : null,
    supportFound: true,
    statement: spec.sentence,
    value: spec.value ?? null,
    unit: spec.unit ?? '',
    approx: spec.approx ?? 'exact',
    provisional: spec.provisional ?? false,
    counted: spec.counted ?? '',
    place: spec.value === undefined ? '' : 'Varrowen Province',
    asOf: spec.asOf ? utcDay(spec.asOf.date) : null,
    asOfPrecision: spec.asOf?.precision ?? null,
    validity: spec.validity,
    verdict: 'supported',
    model: WRITER,
    promptVersion: WRITER,
    createdAt: finishedAt,
  })

  const box = (
    position: number,
    fields: Omit<Prisma.ContextBoxCreateManyInput, 'id' | 'storyId' | 'runId' | 'position'>,
  ): Prisma.ContextBoxCreateManyInput => ({
    id: idFor(`context-box:${seed.key}:${position}`),
    storyId: seed.storyId,
    runId,
    position,
    model: WRITER,
    promptVersion: WRITER,
    writtenAt: finishedAt,
    ...fields,
  })
  const asOfMonth = { asOf: utcDay(month.date), asOfPrecision: 'month' }
  const boxes = [
    box(0, {
      type: 'figures',
      heading: 'In numbers',
      teaser: 'Who the lunches reach and what they cost',
      sentences: [],
      visual: {
        kind: 'tiles',
        tiles: [
          { label: 'pupils covered', factIds: ['S3F3'] },
          { label: 'yearly cost', factIds: ['S4F1'] },
        ],
      },
      ...asOfMonth,
    }),
    box(1, {
      type: 'build_up',
      heading: 'From pilot to every school',
      teaser: 'The program grew in two steps',
      place: 'P1',
      sentences: [{ text: 'The pilot served 180,000 pupils in its first year and 240,000 in its second.', factIds: ['S3F1', 'S3F2'] }],
      visual: {
        kind: 'bars',
        measure: 'pupils getting free school lunches',
        unit: 'pupils',
        points: [
          { label: 'Pilot, year 1', factId: 'S3F1' },
          { label: 'Pilot, year 2', factId: 'S3F2' },
          { label: 'Every school', factId: 'S3F3' },
        ],
        apart: null,
      },
      ...asOfMonth,
    }),
    box(2, {
      type: 'compared',
      heading: 'Attendance rose in the pilot schools',
      teaser: 'Attendance before and during the pilot',
      place: 'W1',
      sentences: [
        {
          text: 'Average attendance in the pilot schools rose from 88% before the pilot to 93% in its second year, by provisional figures.',
          factIds: ['S3F4', 'S3F6'],
        },
      ],
      visual: {
        kind: 'line',
        measure: 'average attendance in pilot schools',
        unit: '%',
        points: [
          { label: 'Before the pilot', factId: 'S3F4' },
          { label: 'Pilot, year 1', factId: 'S3F5' },
          { label: 'Pilot, year 2', factId: 'S3F6' },
        ],
        apart: null,
      },
      asOf: utcDay(inYear(year - 1).date),
      asOfPrecision: 'year',
    }),
    box(3, {
      type: 'next',
      heading: 'The first full-year cost',
      teaser: 'What the province publishes next',
      sentences: [{ text: "The province's budget office will publish the program's first full-year cost next spring.", factIds: ['S4F2'] }],
    }),
    // The honest gap: code adds it, with the page's fixed wording
    box(4, { type: 'response', heading: '', teaser: '', sentences: [], gap: true, model: null, promptVersion: null }),
  ]

  const modelUsd = 0.031
  const credits = 3
  const record: ContextRunRecord = {
    slots: [
      { slot: 'compared', needed: true, covered: 'no' },
      { slot: 'why_now', needed: false, covered: 'yes' },
      { slot: 'build_up', needed: true, covered: 'partly' },
      { slot: 'who_affected', needed: false, covered: 'yes' },
      { slot: 'response', needed: true, covered: 'no' },
      { slot: 'next', needed: true, covered: 'no' },
      { slot: 'key_term', needed: false, covered: 'yes' },
    ],
    responseInStory: null,
    responseFallback: false,
    searches: [
      {
        slot: 'response',
        wanted: 'what the province does about pupils outside public schools',
        query: 'Varrowen free school lunches private schools',
        recent: true,
        cached: false,
        credits: 1,
        results: 0,
        kept: [],
      },
      {
        slot: 'build_up',
        wanted: 'how the pilot grew',
        query: 'Varrowen school lunch pilot pupils attendance',
        recent: false,
        cached: false,
        credits: 1,
        results: 3,
        kept: [office.url],
      },
      {
        slot: 'next',
        wanted: 'what the program will cost',
        query: 'Varrowen free school lunches cost budget',
        recent: true,
        cached: false,
        credits: 1,
        results: 2,
        kept: [watch.url],
      },
    ],
    sourceDrops: [],
    extractionDrops: [],
    facts: { research: research.length, leftOut: 0, search: search.length, reused: 0, supported: research.length + search.length, rejected: 0, unjudged: 0 },
    droppedFacts: [],
    boxDrops: [],
    numberHints: [],
    honestGap: true,
    tally: { checked: research.length + search.length + 6, failed: 0 },
    calls: [],
    optOutChecked: true,
  }

  return {
    run: {
      id: runId,
      storyId: seed.storyId,
      status: 'completed',
      outcome: 'built',
      boxes: boxes.length,
      costUsd: modelUsd + credits * config.research.tavilyUsdPerCredit,
      modelUsd,
      tavilyCredits: credits,
      result: record as unknown as Prisma.InputJsonObject,
      startedAt,
      finishedAt,
    },
    facts: [...research.map(f => fact(f, 'research')), ...search.map(f => fact(f, 'search'))],
    boxes,
  }
}

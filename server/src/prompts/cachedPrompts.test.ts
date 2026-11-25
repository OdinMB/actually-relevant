/**
 * The cached prompts' prefix tests (`.context/prompting.md`, "Prompt caching"): each cached builder,
 * built for two different inputs, has a byte-identical stable part, so every call after the first
 * within the cache's lifetime reads it; and its whole text is the stable part and the data joined.
 */
import { describe, expect, it } from 'vitest'
import { promptText, type PromptParts } from '../lib/promptCache.js'
import { buildAssessPrompt, buildAssessPromptParts } from './assess.js'
import { buildPreassessPrompt, buildPreassessPromptParts } from './preassess.js'
import * as research from './research.js'
import * as context from './storyContext.js'
import * as pass from './researchPass.js'
import * as overviews from './overviews.js'

const guidelines = (n: number) => ({ factors: `factor ${n}`, antifactors: `antifactor ${n}`, ratings: `ratings ${n}` })
const issues = [
  { slug: 'planet', name: 'Planet', description: 'Climate and nature' },
  { slug: 'science', name: 'Science', description: 'Discoveries' },
]

/** Two different calls of one cached builder, and the plain text of the first. */
interface Case {
  name: string
  first: PromptParts
  second: PromptParts
  text: string
  /** Values of the two calls that must sit in the data, never in the stable part. */
  callValues: string[]
}

const cases: Case[] = [
  {
    name: 'assess',
    first: buildAssessPromptParts('Rooftop solar doubles', 'Pakistan added 22GW.', 'Dawn', 'https://a.example/1', guidelines(1)),
    second: buildAssessPromptParts('Polio nearly gone', 'Cases fell to 60.', 'BBC', 'https://b.example/2', guidelines(2), 'uplifting'),
    text: buildAssessPrompt('Rooftop solar doubles', 'Pakistan added 22GW.', 'Dawn', 'https://a.example/1', guidelines(1)),
    callValues: ['Rooftop solar doubles', 'Pakistan added 22GW.', 'Dawn', 'factor 1', 'Polio nearly gone', 'factor 2', '<TONE>'],
  },
  {
    name: 'preassess',
    first: buildPreassessPromptParts([{ id: 'a1', title: 'Solar', content: 'Rooftop solar doubles.' }], issues),
    second: buildPreassessPromptParts(
      [
        { id: 'b1', title: 'Polio', content: 'Cases fell.' },
        { id: 'b2', title: 'Flood', content: 'A river burst its banks.' },
      ],
      issues,
    ),
    text: buildPreassessPrompt([{ id: 'a1', title: 'Solar', content: 'Rooftop solar doubles.' }], issues),
    callValues: ['a1', 'Rooftop solar doubles.', 'b2', 'A river burst its banks.'],
  },
  ...extraction(false),
  ...extraction(true),
  pair('write', research.buildWritePromptParts, research.buildWritePrompt, writeInput('Monsoon', '2026-03-01'), writeInput('Polio', '2026-04-02'), [
    'Monsoon',
    '2026-03-01',
    'Polio',
    '2026-04-02',
    'S1F1',
  ]),
  pair('repair', research.buildRepairPromptParts, research.buildRepairPrompt, repairInput('Paragraph one.'), repairInput('Paragraph two.'), [
    'Paragraph one.',
    'Paragraph two.',
    'S1F1',
  ]),
  pair(
    'fact check',
    (i: research.CheckedItem[]) => research.buildFactCheckPromptParts(i, wording(), [fact('S1F1')]),
    (i: research.CheckedItem[]) => research.buildFactCheckPrompt(i, wording(), [fact('S1F1')]),
    [{ label: 'Story paragraph 1', text: 'Solar doubled.', facts: [fact('S1F1')], numbersNotFound: [] }],
    [{ label: 'Title', text: 'Polio nearly gone', facts: 'pool', numbersNotFound: ['60'] }],
    ['Solar doubled.', 'Polio nearly gone', 'S1F1', 'S1T'],
  ),
  pair('structure', context.buildStructurePromptParts, context.buildStructurePrompt, structureInput('S1F1'), structureInput('S2F4'), ['S1F1', 'S2F4']),
  pair('gap list', context.buildGapListPromptParts, context.buildGapListPrompt, gapInput('Solar'), gapInput('Polio'), ['Solar', 'Polio']),
  pair(
    'context extraction',
    context.buildContextExtractionPromptParts,
    context.buildContextExtractionPrompt,
    contextExtractionInput('Solar'),
    contextExtractionInput('Polio'),
    ['Solar', 'Polio'],
  ),
  pair('boxes', context.buildBoxesPromptParts, context.buildBoxesPrompt, boxesInput('Solar'), boxesInput('Polio'), ['Solar', 'Polio']),
  pair('judge', pass.buildJudgePromptParts, pass.buildJudgePrompt, judgeInput('2026-03-01'), judgeInput('2026-04-02'), ['2026-03-01', '2026-04-02']),
  pair('update rewrite', pass.buildUpdateRewritePromptParts, pass.buildUpdateRewritePrompt, repairInput('Paragraph one.'), repairInput('Paragraph two.'), [
    'Paragraph one.',
    'Paragraph two.',
  ]),
  pair(
    'overview link',
    overviews.buildLinkPromptParts,
    overviews.buildLinkPrompt,
    linkInput('Ebola in Ituri', '2026-05-10'),
    linkInput('Cholera in Sudan', '2026-06-11'),
    ['Ebola in Ituri', 'Cholera in Sudan', '2026-05-10', '2026-06-11'],
  ),
  pair(
    'overview stands',
    overviews.buildStandsPromptParts,
    overviews.buildStandsPrompt,
    standsInput('Ebola in Ituri', '2026-11-18'),
    standsInput('Cholera in Sudan', '2026-11-19'),
    ['Ebola in Ituri', 'Cholera in Sudan', '2026-11-18', '2026-11-19', 'S1F1'],
  ),
]

function standsInput(title: string, today: string): overviews.StandsPromptInput {
  return {
    title,
    entries: [{ title: `${title} story`, date: '2026-11-01', role: { role: 'routine', roleKind: null } }],
    facts: [{ id: 'S1F1', text: `${title} fact.`, outlet: 'Outlet', date: '2026-11-01', current: true, response: false }],
    today,
    maxSentences: 4,
    maxDoing: 2,
  }
}

function linkInput(title: string, date: string): overviews.LinkInput {
  const story = { id: 's', title, label: 'Label', summary: 'Summary.', datePublished: new Date(`${date}T12:00:00Z`), date, issueId: null, facts: ['Fact.'] }
  return {
    story,
    overviews: [{ ref: 'O1', id: 'o', title: `${title} overview`, charter: { in: 'In.', out: [], endEvent: 'End.' }, entries: [{ title: 'Entry', date }] }],
    partners: [{ ...story, id: 'p', ref: 'F1' }],
  }
}

/** A case from a cached builder, its plain twin and two inputs. */
function pair<I>(name: string, parts: (input: I) => PromptParts, plain: (input: I) => string, a: I, b: I, callValues: string[]): Case {
  return { name, first: parts(a), second: parts(b), text: plain(a), callValues }
}

function fact(id: string) {
  return { id, statement: `Fact ${id}.`, supportingSentence: `Sentence of ${id}.`, measures: '' }
}

function wording() {
  return [{ id: 'S1T', sourceId: 'S1', role: 'title' as const, text: 'A title' }]
}

function extraction(structured: boolean): Case[] {
  // The story's own article may give more facts than another source: the cap is a per-call value
  const input = (title: string, maxFacts: number) => ({
    story: { title, summary: `${title} summary` },
    source: { outlet: `${title} Times`, url: `https://${title}.example`, date: null, title: `${title} page`, text: `${title} text` },
    maxFacts,
  })
  return [
    {
      name: structured ? 'extraction, structured' : 'extraction',
      first: research.buildExtractionPromptParts(input('Solar', 12), { structured }),
      second: research.buildExtractionPromptParts(input('Polio', 8), { structured }),
      text: research.buildExtractionPrompt(input('Solar', 12), { structured }),
      callValues: ['Solar', 'Polio'],
    },
  ]
}

function writeInput(title: string, oldBefore: string): research.WriteInput {
  const source = {
    id: 'S1',
    outlet: 'Dawn',
    kind: 'news-report',
    country: 'Pakistan',
    date: null,
    relation: 'same-development',
    facts: [fact('S1F1')],
    voices: [],
  }
  return {
    article: { title, content: '', publisher: 'Dawn', url: 'https://a.example', guidelines: guidelines(1) } as unknown as research.WriteInput['article'],
    articleDate: '2026-01-01',
    oldBefore,
    sources: [source],
    earlier: [],
  }
}

function repairInput(text: string): research.RepairInput {
  return {
    sources: [
      { id: 'S1', outlet: 'Dawn', kind: 'news-report', country: 'Pakistan', date: null, relation: 'same-development', facts: [fact('S1F1')], voices: [] },
    ],
    earlier: [],
    story: [{ label: 'Story paragraph 1', text }],
    repairs: [{ label: 'Story paragraph 1', text, factIds: ['S1F1'], problems: ['A problem.'] }],
  }
}

function structureInput(id: string) {
  return {
    facts: [{ id, statement: 'A statement.', supportingSentence: 'A sentence.', measures: '', source: { outlet: 'Dawn', date: null, kind: 'news-report' } }],
  }
}

function storyText(title: string): context.StoryText {
  return { title, date: '2026-01-01', paragraphs: [{ id: 'P1', text: `${title} paragraph` }], points: [], caveats: [] }
}

function gapInput(title: string) {
  return { story: storyText(title), facts: [{ id: 'S1F1', text: `${title} fact`, current: true }] }
}

function contextExtractionInput(title: string): context.ContextExtractionInput {
  return {
    story: { title, summary: `${title} summary` },
    wanted: [{ slot: 'compared', wanted: `${title} record` }],
    source: { outlet: 'Dawn', url: 'https://a.example', date: null, title: `${title} page`, text: `${title} text` },
  }
}

function boxesInput(title: string): context.BoxesInput {
  return {
    story: storyText(title),
    facts: [{ id: 'S1F1', text: `${title} fact`, outlet: 'Dawn', date: null, current: true }],
    needed: [{ slot: 'compared', covered: 'yes' }],
    responseInStory: title === 'Polio',
  }
}

function judgeInput(storyDay: string) {
  const brief = { id: 'S1F1', statement: 'Fact.', measures: '', supportingSentence: 'Sentence.', outlet: 'Dawn', date: '2026-01-01' }
  return {
    storyDay,
    sections: [{ label: 'Story paragraph 1', text: `Published ${storyDay}.`, factIds: ['S1F1'] }],
    cited: [brief],
    fresh: [{ ...brief, id: 'S2F1' }],
  }
}

describe('cached prompts', () => {
  it.each(cases)('$name: the stable part is byte-identical across calls', ({ first, second }) => {
    expect(second.stable).toBe(first.stable)
    expect(first.data).not.toBe(second.data)
  })

  it.each(cases)('$name: the whole text is the stable part and the data, as the plain builder returns it', ({ first, text }) => {
    expect(promptText(first)).toBe(text)
    expect(first.stable.endsWith('\n\n')).toBe(true)
  })

  it.each(cases)("$name: the call's own values sit in the data", ({ first, second, callValues }) => {
    for (const value of callValues) expect(first.stable).not.toContain(value)
    for (const value of callValues) expect(first.data + second.data).toContain(value)
  })
})

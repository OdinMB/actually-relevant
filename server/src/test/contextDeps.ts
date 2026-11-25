/**
 * Fake story context deps for the db tests of a run (`storyContextRuns`, `storyContextOnDemand`):
 * every step answered without a model or a web search. The answers are a map keyed by the step and
 * typed by its schema, so a step a run gains, or a field a step's schema gains, fails the type-check
 * here until it is answered (this file is type-checked, the test files are not).
 */
import { ZERO_USAGE } from '../lib/llmUsage.js'
import { promptText } from '../lib/promptCache.js'
import type { FactCheck } from '../schemas/research.js'
import type { BoxesAnswer, ContextExtraction, FigureCheck, GapList, StructureAnswer, StructuredFact, WrittenBox } from '../schemas/storyContext.js'
import type { ContextDeps, ContextStep } from '../services/storyContextPipeline.js'

/** What each step's call answers, by its schema; null where the fake answers with nothing. */
interface StepAnswers {
  structure: StructureAnswer
  'gap-list': GapList
  extract: ContextExtraction | null
  'figure-check': FigureCheck
  'fact-check': FactCheck
  write: BoxesAnswer | null
  'box-check': FactCheck
}
type Answerers = { [S in ContextStep]: (prompt: string) => StepAnswers[S] }

const fields: StructuredFact = {
  value: null,
  valueHigh: null,
  unit: '',
  approx: 'exact',
  provisional: false,
  counted: '',
  place: '',
  asOf: '',
  credited: '',
  creditedKind: 'none',
  validity: 'fixed',
}

/** The one research fact with a figure. */
const S0F1_FIGURE: Partial<StructuredFact> = { value: 2_880_000, unit: 'hectares', counted: 'area burned in Indonesia', asOf: '2026-11' }

/** The first capture of `pattern` in each of its matches in the prompt: the ids of its facts, items or figures. */
const captured = (prompt: string, pattern: RegExp) => [...prompt.matchAll(pattern)].map(m => m[1]!)

const noVisual: WrittenBox['visual'] = { kind: 'none', tiles: [], measure: '', unit: '', points: [], apart: null }

/** The write's two boxes: "who it reaches", whose one tile is the figure, and a box of one sentence citing the other fact. */
const twoBoxes = (figure: string, other: string): BoxesAnswer => ({
  boxes: [
    {
      slot: 'who_affected',
      heading: 'Land the fires reach',
      teaser: 'Hectares burned',
      place: 'section',
      sentences: [],
      visual: { ...noVisual, kind: 'tiles', tiles: [{ label: 'hectares burned', factIds: [figure] }] },
    },
    {
      slot: 'compared',
      heading: 'Twice the usual',
      teaser: 'Twice the usual area',
      place: 'P1',
      sentences: [{ text: 'It is twice the usual.', factIds: [other] }],
      visual: noVisual,
    },
  ],
})

/** Every item of a fact or box check supported. */
const allSupported = (prompt: string): FactCheck => ({
  items: captured(prompt, /<ITEM number="(\d+)"/g).map(n => ({
    number: Number(n),
    supported: true,
    problem: '',
    key: false,
    copiedSentence: '',
    followsSource: '',
  })),
})

const answered = <T>(parsed: T | null, step: ContextStep) => ({
  parsed: parsed as never,
  outcome: parsed === null ? ('parse_failure' as const) : ('ok' as const),
  usage: ZERO_USAGE,
  costUsd: 0.002,
  model: `model-${step}`,
})

/**
 * Answers every step: research's facts structured (S0F1 with a figure), nothing missing, every figure
 * given by its source (the figure check, ADR-0080), all supported, a box with the figure as its tile
 * and a box of sentences. `failWrite` answers the write with nothing; `writeError` fails it as a
 * problem that may pass (`transient`) or one that would not (`lasting`).
 */
export function fakeContextDeps(options: { failWrite?: boolean; writeError?: 'transient' | 'lasting' } = {}): ContextDeps {
  const answers: Answerers = {
    structure: prompt => ({ facts: captured(prompt, /<FACT id="([^"]+)"/g).map(id => ({ id, ...fields, ...(id === 'S0F1' ? S0F1_FIGURE : {}) })) }),
    'gap-list': () => ({
      slots: [{ slot: 'response', needed: true, covered: 'yes' }],
      responseInStory: '',
      responseSearches: { action: '', elsewhere: '' },
      searches: [],
    }),
    // Never asked: the gap list leaves nothing to search, and a search finds nothing
    extract: () => null,
    'figure-check': prompt => ({ figures: captured(prompt, /<FIGURE id="([^"]+)"/g).map(id => ({ id, inSource: 'given' })) }),
    'fact-check': allSupported,
    write: () => (options.failWrite ? null : twoBoxes('S0F1', 'S0F2')),
    'box-check': allSupported,
  }
  return {
    async call(step, _schema, sent) {
      if (step === 'write' && options.writeError)
        return { parsed: null, outcome: 'error', usage: ZERO_USAGE, costUsd: 0, model: 'model-write', transient: options.writeError === 'transient' }
      return answered(answers[step](promptText(sent)), step)
    },
    search: async () => ({ results: [], credits: 0, cached: false }),
  }
}

/**
 * As `fakeContextDeps()`, but the write cites the facts its prompt offers, whatever their ids: the
 * figure for the tile, the other fact for the compared box. `steps` collects the steps called.
 */
export function citingContextDeps(steps: string[] = []): ContextDeps {
  const base = fakeContextDeps()
  return {
    ...base,
    async call(step, schema, sent) {
      steps.push(step)
      if (step !== 'write') return base.call(step, schema, sent)
      const facts = [...promptText(sent).matchAll(/<FACT id="([^"]+)"[^>]*>([^<]*)<\/FACT>/g)].map(m => ({ id: m[1]!, text: m[2]! }))
      const figure = facts.find(f => f.text.includes('hectares'))!.id
      const other = facts.find(f => f.id !== figure)!.id
      return answered(twoBoxes(figure, other), step)
    },
  }
}

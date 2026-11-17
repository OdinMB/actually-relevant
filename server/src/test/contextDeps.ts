/**
 * Fake story context deps for the db tests of a run (`storyContextRuns`, `storyContextOnDemand`):
 * every step answered without a model or a web search.
 */
import { ZERO_USAGE } from '../lib/llmUsage.js'
import type { ContextDeps } from '../services/storyContextPipeline.js'

const fields = {
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

const noVisual = { kind: 'none', tiles: [], measure: '', unit: '', points: [], apart: null }

/**
 * Answers every step: research's facts structured (S0F1 with a figure), nothing missing, all
 * supported, one box and the figures. `failWrite` answers the write with nothing; `writeError` fails
 * it as a problem that may pass (`transient`) or one that would not (`lasting`).
 */
export function fakeContextDeps(options: { failWrite?: boolean; writeError?: 'transient' | 'lasting' } = {}): ContextDeps {
  return {
    async call(step, _schema, prompt) {
      let parsed: unknown
      if (step === 'structure')
        parsed = {
          facts: [...prompt.matchAll(/<FACT id="([^"]+)"/g)].map(m => ({
            id: m[1],
            ...fields,
            ...(m[1] === 'S0F1' ? { value: 2_880_000, unit: 'hectares', counted: 'area burned in Indonesia', asOf: '2026-11' } : {}),
          })),
        }
      else if (step === 'gap-list')
        parsed = {
          slots: [{ slot: 'response', needed: true, covered: 'yes' }],
          responseInStory: '',
          responseSearches: { action: '', elsewhere: '' },
          searches: [],
        }
      else if (step === 'write')
        parsed = options.failWrite
          ? null
          : {
              figures: { heading: 'In numbers', teaser: 'The figures', tiles: [{ label: 'hectares burned', factIds: ['S0F1'] }] },
              boxes: [
                {
                  slot: 'compared',
                  heading: 'Twice the usual',
                  teaser: 'Twice the usual area',
                  place: 'P1',
                  sentences: [{ text: 'It is twice the usual.', factIds: ['S0F2'] }],
                  visual: noVisual,
                },
              ],
            }
      else
        parsed = {
          items: [...prompt.matchAll(/<ITEM number="(\d+)"/g)].map(m => ({
            number: Number(m[1]),
            supported: true,
            problem: '',
            key: false,
            copiedSentence: '',
            followsSource: '',
          })),
        }
      if (step === 'write' && options.writeError)
        return { parsed: null, outcome: 'error', usage: ZERO_USAGE, costUsd: 0, model: 'model-write', transient: options.writeError === 'transient' }
      return { parsed: parsed as never, outcome: parsed === null ? 'parse_failure' : 'ok', usage: ZERO_USAGE, costUsd: 0.002, model: `model-${step}` }
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
    async call(step, schema, prompt) {
      steps.push(step)
      if (step !== 'write') return base.call(step, schema, prompt)
      const facts = [...prompt.matchAll(/<FACT id="([^"]+)"[^>]*>([^<]*)<\/FACT>/g)].map(m => ({ id: m[1]!, text: m[2]! }))
      const figure = facts.find(f => f.text.includes('hectares'))!.id
      const other = facts.find(f => f.id !== figure)!.id
      const parsed = {
        figures: { heading: 'In numbers', teaser: 'The figures', tiles: [{ label: 'hectares burned', factIds: [figure] }] },
        boxes: [
          {
            slot: 'compared',
            heading: 'Twice the usual',
            teaser: 'Twice the usual area',
            place: 'P1',
            sentences: [{ text: 'It is twice the usual.', factIds: [other] }],
            visual: noVisual,
          },
        ],
      }
      return { parsed: parsed as never, outcome: 'ok', usage: ZERO_USAGE, costUsd: 0.002, model: 'model-write' }
    },
  }
}

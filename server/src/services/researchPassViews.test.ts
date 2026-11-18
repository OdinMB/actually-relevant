/**
 * The admin's pass view of a stored record (`passRecordView`): the calls under the pass's step names
 * and the problems the final drafts kept, read from whatever the row holds. The reads on PostgreSQL
 * are researchPassRuns.db.test.ts's.
 */
import { describe, it, expect } from 'vitest'
import { passRecordView } from './researchPassViews.js'

const usage = { input: 100, cached: 0, output: 20, reasoning: 0 }
const call = (step: string, model: string, costUsd: number) => ({ step, outcome: 'ok', usage, costUsd, model })

describe('passRecordView', () => {
  it("lists every call under its pass step's name, research's and the cards' steps of one name apart, and the problems the final drafts kept", () => {
    const stored = {
      research: {
        calls: [call('extract', 'small', 0.01), call('write', 'medium', 0.03), call('fact-check', 'small', 0.004)],
        problems: [{ label: 'Title', text: 't', problem: 'not in its facts', kind: 'fact', by: 'judge' }],
      },
      context: {
        calls: [call('extract', 'small', 0.002), call('write', 'small', 0.005), call('fact-check', 'small', 0.001), call('structure', 'small', 0.001)],
      },
      update: { calls: [call('judge', 'medium', 0.006)], problems: [{ label: 'Caveat 1', text: 't', problem: 'too close' }] },
      cards: 'written',
    }
    const view = passRecordView(stored)
    expect(view.calls.map(c => c.step)).toEqual(['extract', 'write', 'fact-check', 'judge', 'gap-extract', 'cards-write', 'facts-check', 'structure'])
    expect(view.calls[1]).toEqual({ step: 'write', model: 'medium', costUsd: 0.03 })
    expect(view.calls[5]).toEqual({ step: 'cards-write', model: 'small', costUsd: 0.005 })
    expect(view.problems).toEqual([
      { label: 'Title', text: 't', problem: 'not in its facts', kind: 'fact', by: 'judge' },
      { label: 'Caveat 1', text: 't', problem: 'too close' },
    ])
  })

  it('reads a record a pass stored partly, and none while the pass runs', () => {
    expect(passRecordView(null)).toEqual({ calls: [], problems: [] })
    expect(passRecordView({ research: { calls: [call('queries', 'small', 0.002)] } })).toEqual({
      calls: [{ step: 'queries', model: 'small', costUsd: 0.002 }],
      problems: [],
    })
  })
})

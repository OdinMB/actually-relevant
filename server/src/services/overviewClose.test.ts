import { describe, expect, it } from 'vitest'
import type { CloseAnswer, CloseCheckAnswer } from '../schemas/overviews.js'
import { acceptClosing, checkClosing, type CloseCase, type CloseDeps } from './overviewClose.js'
import type { ModelCall } from './overviewLink.js'

const story = {
  id: 's',
  title: 'WHO declares the Ituri Ebola outbreak over',
  label: 'Outbreak ends',
  summary: 'The health ministry and the WHO declared the outbreak over after 42 days without a case.',
  datePublished: new Date('2026-11-10T12:00:00Z'),
  date: '2026-11-10',
  issueId: null,
  facts: [],
}

const c: CloseCase = {
  overviewId: 'o',
  charter: { in: 'Ebola in Ituri.', out: ['Ebola in Uganda'], endEvent: 'The health ministry declares the outbreak over' },
  story,
  entries: [{ title: 'Cases fall', date: '2026-10-20' }],
}

const yes = (quote = 'declared the outbreak over'): CloseAnswer => ({ happened: 'yes', quote, reason: 'Declared.' })
const call = <T>(parsed: T | null, costUsd = 0.05): ModelCall<T> => ({ parsed, costUsd, model: 'large' })

function deps(close: CloseAnswer | null, check: CloseCheckAnswer | null): CloseDeps & { asked: string[] } {
  const asked: string[] = []
  return {
    asked,
    close: async () => {
      asked.push('close')
      return call(close)
    },
    closeCheck: async input => {
      asked.push(`check:${input.endEvent}`)
      return call(check)
    },
  }
}

describe('closing at the end event', () => {
  it('starts closing only when both calls agree and the first quotes the story', async () => {
    const d = deps(yes(), { happened: 'yes', reason: 'Declared over.' })
    const result = await checkClosing(c, d)
    expect(result.outcome).toBe('closing')
    expect(d.asked).toEqual(['close', 'check:The health ministry declares the outbreak over'])
    expect(result.costUsd).toBeCloseTo(0.1)
  })

  it('asks no check when the first call says no or quotes words the story lacks', async () => {
    const no = deps({ happened: 'no', quote: '', reason: 'Only expected.' }, null)
    expect((await checkClosing(c, no)).outcome).toBe('not_happened')
    expect(no.asked).toEqual(['close'])
    const unquoted = deps(yes('the outbreak in Uganda is over'), { happened: 'yes', reason: '' })
    expect((await checkClosing(c, unquoted)).outcome).toBe('unquoted')
    expect(unquoted.asked).toEqual(['close'])
  })

  it('founds nothing on disagreement, and fails when a call gives nothing', async () => {
    expect((await checkClosing(c, deps(yes(), { happened: 'no', reason: 'Expected only.' }))).outcome).toBe('disagreed')
    expect((await checkClosing(c, deps(null, null))).outcome).toBe('failed')
    expect((await checkClosing(c, deps(yes(), null))).outcome).toBe('failed')
  })

  it('reads a quote the model escaped as the story words', () => {
    expect(acceptClosing(yes('WHO declares the Ituri Ebola outbreak over'), { happened: 'yes', reason: '' }, story)).toBe('closing')
    expect(acceptClosing(yes('  declared   the outbreak OVER '), { happened: 'yes', reason: '' }, story)).toBe('closing')
  })
})

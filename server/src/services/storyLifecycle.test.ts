/**
 * The transition table's pure rules; every move on PostgreSQL is storyLifecycle.db.test.ts's.
 */
import { describe, it, expect } from 'vitest'
import { allowedFrom } from './storyLifecycle.js'

describe('allowedFrom', () => {
  it.each(['stale', 'contradicted'] as const)('lets the research step reject with %s only a selected story', reason => {
    expect(allowedFrom({ to: 'rejected', reason }, 'pipeline')).toEqual(['selected'])
  })

  it('gives the pipeline no rejection for a research rating below the bar (owner decision 2026-11-12); an editor rejects from anywhere', () => {
    expect(() => allowedFrom({ to: 'rejected', reason: 'research_rating' }, 'pipeline')).toThrow(/no move to rejected \(research_rating\)/)
    expect(allowedFrom({ to: 'rejected', reason: 'editor' }, 'editor')).not.toContain('rejected')
  })
})

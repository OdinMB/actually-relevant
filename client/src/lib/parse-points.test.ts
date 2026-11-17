import { describe, it, expect } from 'vitest'
import table from '@shared/fixtures/parse-points.json'
import { parsePoints } from './parse-points'

// The case table the server's mirror runs too (server/src/services/storyContextLayout.ts), so story
// context's point ids (W1…) name the points the page shows
describe('parsePoints', () => {
  it.each(table.cases)('$name', ({ text, points }) => {
    expect(parsePoints(text)).toEqual(points)
  })
})

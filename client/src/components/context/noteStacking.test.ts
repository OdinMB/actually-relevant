import { describe, expect, it } from 'vitest'
import { clearanceBelow, stackNotes } from './noteStacking'

describe('stackNotes', () => {
  it('keeps each note level with its paragraph while they do not overlap', () => {
    expect(
      stackNotes(
        [
          { top: 0, height: 100 },
          { top: 200, height: 50 },
        ],
        16,
      ),
    ).toEqual([0, 200])
  })

  it('moves a later note down below the one above when it would overlap it, and the ones after it along', () => {
    expect(
      stackNotes(
        [
          { top: 0, height: 300 },
          { top: 120, height: 100 },
          { top: 400, height: 50 },
          { top: 900, height: 50 },
        ],
        16,
      ),
    ).toEqual([0, 316, 432, 900])
  })
})

describe('clearanceBelow', () => {
  it('pushes what follows below the last note only when the note reaches into it', () => {
    expect(clearanceBelow(500, 600, 24)).toBe(0)
    expect(clearanceBelow(590, 600, 24)).toBe(14)
    expect(clearanceBelow(null, 600, 24)).toBe(0)
  })
})

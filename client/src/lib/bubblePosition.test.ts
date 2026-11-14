import { describe, it, expect } from 'vitest'
import { bubblePosition } from './bubblePosition'

const viewport = { width: 1000, height: 800 }
const size = { width: 300, height: 120 }
/** A 24px trigger at `left`, its top at `top`. */
const trigger = (top: number, left = 100) => ({ top, bottom: top + 24, left })

describe('bubblePosition', () => {
  it('opens below the trigger, at its left edge, when there is room below', () => {
    expect(bubblePosition(trigger(200), size, viewport)).toEqual({ side: 'below', top: 224, left: 100 })
  })

  it('opens above when the bubble does not fit below but fits above', () => {
    expect(bubblePosition(trigger(700), size, viewport)).toEqual({ side: 'above', top: 580, left: 100 })
  })

  it('takes the side with more room when it fits on neither', () => {
    const tall = { width: 300, height: 500 }
    expect(bubblePosition(trigger(300), tall, viewport).side).toBe('below')
    expect(bubblePosition(trigger(450), tall, viewport).side).toBe('above')
  })

  it('moves left to stay inside the right edge, never past the left margin', () => {
    expect(bubblePosition(trigger(200, 900), size, viewport).left).toBe(1000 - 8 - 300)
    expect(bubblePosition(trigger(200, 2), size, viewport).left).toBe(8)
    expect(bubblePosition(trigger(200, 50), { width: 990, height: 120 }, viewport).left).toBe(8)
  })
})

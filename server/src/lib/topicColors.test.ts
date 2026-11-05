import { describe, it, expect } from 'vitest'
import { DEFAULT_TOPIC_COLOR, topicColor } from './topicColors.js'

describe('topicColor', () => {
  it("gives a top-level topic its own color and any other topic the brand pink, as the website's category colors do", () => {
    expect(topicColor('planet-climate')).toBe('#2dd4bf')
    expect(topicColor('pandemics')).toBe(DEFAULT_TOPIC_COLOR)
    expect(topicColor('toString')).toBe(DEFAULT_TOPIC_COLOR)
  })
})

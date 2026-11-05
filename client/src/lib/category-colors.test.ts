import { describe, it, expect } from 'vitest'
import { getCategoryColor } from './category-colors'
import { contrastRatio } from '../test/contrast'

const SLUGS = ['human-development', 'planet-climate', 'existential-threats', 'science-technology', 'general-news']

describe('category colors', () => {
  it.each(SLUGS)('%s: has a text shade of its hue that reaches 4.5:1 on white', slug => {
    expect(contrastRatio(getCategoryColor(slug).textHex, '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })
})

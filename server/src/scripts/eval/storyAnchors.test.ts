import { describe, it, expect } from 'vitest'
import { findStoryAnchors, findUnstatedNames } from './storyAnchors.js'

const story = [
  'India pledges to buy $500 billion of US goods',
  'The deal, announced by India\'s prime minister Narendra Modi on Monday, ends purchases of Russian oil. Tariffs fall to 18%.',
].join('\n')

describe('findStoryAnchors', () => {
  it('finds a named actor from the story, also at the start of a post sentence', () => {
    expect(findStoryAnchors('India just bet its energy future on one trade deal.', story)).toEqual(['India'])
    expect(findStoryAnchors('Modi has picked a side.', story)).toEqual(['Modi'])
  })

  it('finds acronyms and numbers the story contains', () => {
    expect(findStoryAnchors('The US just gained a big energy customer.', story)).toEqual(['US'])
    expect(findStoryAnchors('A $500 billion promise is a lot of soybeans.', story)).toEqual(['$500 billion'])
  })

  it('ignores sentence starters, weekdays, names the story lacks and numbers it does not state', () => {
    expect(findStoryAnchors('This could reshape energy markets for years.', story)).toEqual([])
    expect(findStoryAnchors('Tariffs are only half of it.', story)).toEqual([])
    expect(findStoryAnchors('Since Monday, everything changed.', story)).toEqual([])
    expect(findStoryAnchors('Brazil will be watching closely.', story)).toEqual([])
    expect(findStoryAnchors('A $600 billion promise.', story)).toEqual([])
  })

  it('reads dotted acronyms such as U.S. as one name, in either spelling', () => {
    const pentagon = 'U.S. military turns to tech firms\nThe U.S. Department of Defense has shifted to commercial partnerships.'
    expect(findStoryAnchors('The U.S. military is betting on vendors.', pentagon)).toEqual(['US'])
    expect(findStoryAnchors('The US military is betting on vendors.', pentagon)).toEqual(['US'])
  })

  it('does not count topic acronyms as actors', () => {
    const tech = 'The lab said its AI model helps HIV and COVID-19 research at Google.'
    expect(findStoryAnchors('Faster AI could speed up HIV and COVID-19 work.', tech)).toEqual([])
    expect(findStoryAnchors('Faster AI at Google could speed up HIV work.', tech)).toEqual(['Google'])
  })
})

describe('findUnstatedNames', () => {
  it('lists names a post adds that the story never mentions, skipping sentence starters and hashtags', () => {
    expect(findUnstatedNames('That leaves Brazil and the IMF on the sidelines.', story)).toEqual(['Brazil', 'IMF'])
    expect(findUnstatedNames('Modi picked a side. Everyone noticed. #India #Trade', story)).toEqual([])
    expect(findUnstatedNames('Russian oil loses a big buyer in India.', story)).toEqual([])
  })
})

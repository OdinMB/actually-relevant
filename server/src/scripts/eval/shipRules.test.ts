import { describe, it, expect } from 'vitest'
import type { SocialPostItem } from './fixtures.js'
import type { Criterion } from './recalibration.js'
import { checkShipPost, socialPostCriteria } from './shipRules.js'

const item = (platform: SocialPostItem['platform'] = 'mastodon'): SocialPostItem => ({
  id: 's1',
  platform,
  story: {
    id: 's1',
    title: 'India pledges to buy $500 billion of US goods',
    titleLabel: 'Trade deal',
    summary: 'The deal, announced by India\'s prime minister Narendra Modi, ends purchases of Russian oil.',
    relevanceSummary: 'Cutting Russian oil purchases removes a major revenue source for the war in Ukraine.',
    maxChars: 120,
  },
})
const failing = (criteria: Criterion[]) => criteria.filter(c => c.required && !c.pass).map(c => c.name)

describe('checkShipPost', () => {
  it('reads the anchors from the whole story the prompt shows, including why it matters', () => {
    expect(checkShipPost(item(), 'Ukraine could feel this one: a big buyer of Russian oil just walked away.').anchors).toEqual(['Ukraine', 'Russian'])
  })

  it('flags numbers and names the story does not contain', () => {
    const c = checkShipPost(item(), 'India will buy $800 billion from the US and Brazil.')
    expect(c.unsupported).toEqual(['$800 billion'])
    expect(c.unstatedNames).toEqual(['Brazil'])
  })

  it('judges length against the platform limit before any trim', () => {
    expect(checkShipPost(item(), `India ${'x'.repeat(120)}`).overLimit).toBe(true)
  })
})

describe('socialPostCriteria', () => {
  const good = checkShipPost(item(), 'Modi just made a big bet on the US.')

  it('accepts drafts that all name an actor or number, within length and faithful', () => {
    expect(failing(socialPostCriteria([good, good], 0))).toEqual([])
  })

  it('fails when one draft names nothing from the story, runs long, or adds a number', () => {
    const vague = checkShipPost(item(), 'This could change how the world buys energy.')
    const long = checkShipPost(item(), `Modi ${'x'.repeat(120)}`)
    const inflated = checkShipPost(item(), 'Modi pledged $900 billion.')
    expect(failing(socialPostCriteria([good, vague], 0))).toEqual(['Posts naming the story\'s actor or a key number'])
    expect(failing(socialPostCriteria([good, long], 0))).toEqual(['Raw drafts over the length limit'])
    expect(failing(socialPostCriteria([good, inflated], 0))).toEqual(['Drafts with numbers the story does not state'])
  })

  it('never accepts a run with failed calls or no drafts', () => {
    expect(failing(socialPostCriteria([good], 1))).toEqual(['Failed calls'])
    expect(failing(socialPostCriteria([], 0))).not.toEqual([])
  })

  it('reports added names for the spot check without failing on them', () => {
    const added = checkShipPost(item(), 'Modi and Brazil agree.')
    const criteria = socialPostCriteria([added], 0)
    expect(failing(criteria)).toEqual([])
    expect(criteria.find(c => c.name.startsWith('Drafts naming'))?.value).toBe('1 of 1')
  })
})

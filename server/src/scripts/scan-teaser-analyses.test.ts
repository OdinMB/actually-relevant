import { describe, it, expect } from 'vitest'
import { teaserReason, type ScannedStory } from './scan-teaser-analyses.js'

const longText = 'A full article paragraph that keeps going for quite a while. '.repeat(50)

function story(overrides: Partial<ScannedStory> = {}): ScannedStory {
  return { slug: 's', sourceTitle: 'T', feedTitle: 'F', sourceContent: longText, analysis: [], ...overrides }
}

describe('teaserReason', () => {
  it('flags an analysis that remarks on missing content', () => {
    const reason = teaserReason(story({ analysis: ['Only the headline is accessible; the rest is behind a paywall.'] }), 1500)
    expect(reason).toMatch(/^analysis:/)
  })

  it('does not flag an ordinary antifactor', () => {
    const reason = teaserReason(story({ analysis: ['Limited to one region; subscriber numbers of the service are small.'] }), 1500)
    expect(reason).toBeNull()
  })

  it('flags a publisher subscribe prompt left in the source text', () => {
    const reason = teaserReason(story({ sourceContent: `${longText} Diesen Artikel weiterlesen mit SPIEGEL+` }), 1500)
    expect(reason).toMatch(/^source text:/)
  })

  it('flags a short source text, measured with whitespace collapsed', () => {
    const reason = teaserReason(story({ sourceContent: `Short teaser.${'\n'.repeat(3000)}` }), 1500)
    expect(reason).toMatch(/under 1500/)
  })
})

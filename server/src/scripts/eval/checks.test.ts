import { describe, it, expect } from 'vitest'
import {
  findForeignScript,
  checkAssessFormat,
  findUnsupportedNumbers,
  percentile,
  jaccard,
  countWords,
  splitSentences,
  summarizeCalls,
  checkSocialPost,
  checkIntro,
  checkPodcast,
} from './checks.js'
import type { AssessResult } from '../../schemas/llm.js'
import type { CallRecord } from './types.js'

describe('findForeignScript', () => {
  it('flags Han, Cyrillic and Arabic inside English text', () => {
    expect(findForeignScript('Prices rose 5% 在 Beijing')).toEqual(['在'])
    expect(findForeignScript('The ministry (министерство) said')).not.toHaveLength(0)
    expect(findForeignScript('Officials in قطر agreed')).not.toHaveLength(0)
  })

  it('ignores accented Latin, em dashes, digits, currency and emoji', () => {
    expect(findForeignScript('São Paulo — Müller said €4.5bn, ¥20, £3 and 50% 🎉 café naïve')).toEqual([])
  })
})

function compliantAssessment(): AssessResult {
  return {
    publicationDate: '2026-05-01 00:00:00',
    quote: 'We will act now.',
    quoteAttribution: 'Jane Doe, Minister',
    summary: Array.from({ length: 50 }, (_, i) => `word${i}`).join(' '),
    factors: [
      '- **Scale:** One.',
      '- **Policy:** Two.',
      '- **Norms:** Three.',
      '- **Science:** Four.',
    ],
    limitingFactors: ['- **Early stage:** Not yet.'],
    relevanceCalculation: ['- **Scale:** 6', '- **Early stage:** -1', '- **Other:** +0'],
    conservativeRating: 5,
    relevanceSummary: Array.from({ length: 22 }, (_, i) => `term${i}`).join(' '),
    titleLabel: 'Ocean health',
    relevanceTitle: 'Coral reefs recover after fishing ban in Fiji',
    marketingBlurb: 'The Guardian reports reefs are recovering.',
  }
}

describe('checkAssessFormat', () => {
  it('passes a compliant assessment', () => {
    const result = checkAssessFormat(compliantAssessment())
    expect(Object.entries(result).filter(([, ok]) => !ok)).toEqual([])
  })

  const cases: [string, (a: AssessResult) => void, string][] = [
    ['3 factors', a => { a.factors = a.factors.slice(0, 3) }, 'factorCount'],
    ['71-word summary', a => { a.summary = Array.from({ length: 71 }, () => 'w').join(' ') }, 'summaryWords'],
    ['11-word title', a => { a.relevanceTitle = Array.from({ length: 11 }, (_, i) => `t${i}`).join(' ') }, 'titleWords'],
    ['"Label: headline" title', a => { a.relevanceTitle = 'Reefs: coral recovers after ban' }, 'titleNoColon'],
    ['4-word label', a => { a.titleLabel = 'Very long topic label' }, 'labelWords'],
    ['label with "and"', a => { a.titleLabel = 'Fish and seas' }, 'labelWords'],
    ['231-char blurb', a => { a.marketingBlurb = 'x'.repeat(231) }, 'blurbLength'],
    ['label/title word overlap', a => { a.titleLabel = 'Coral reefs' }, 'labelTitleDistinct'],
    ['bad date', a => { a.publicationDate = '2026-05-01' }, 'dateFormat'],
    ['factor without bold label', a => { a.factors[0] = 'Scale matters.' }, 'factorFormat'],
    ['no limiting factors', a => { a.limitingFactors = [] }, 'limitingCount'],
    ['6 calculation bullets', a => { a.relevanceCalculation = Array(6).fill('- **x:** 1') }, 'calculationCount'],
    ['19-word relevance summary', a => { a.relevanceSummary = Array(19).fill('w').join(' ') }, 'relevanceSummaryWords'],
  ]

  for (const [label, mutate, rule] of cases) {
    it(`detects ${label} on its own`, () => {
      const a = compliantAssessment()
      mutate(a)
      const failing = Object.entries(checkAssessFormat(a)).filter(([, ok]) => !ok).map(([k]) => k)
      expect(failing).toEqual([rule])
    })
  }
})

describe('findUnsupportedNumbers', () => {
  it('treats 1,200 and 1200 as the same number', () => {
    expect(findUnsupportedNumbers('About 1,200 people', 'Some 1200 residents').unsupported).toEqual([])
  })

  it('normalises dollar amounts with scale words', () => {
    expect(findUnsupportedNumbers('Cutting $4.5 billion', 'a cut of 4,500 million dollars').unsupported).toEqual([])
    expect(findUnsupportedNumbers('Cutting $4.5 billion', 'a cut of $4.5bn').unsupported).toEqual([])
  })

  it('reports numbers absent from the source', () => {
    const result = findUnsupportedNumbers('Affects 20 million people by 2030', 'Affects 20 million people')
    expect(result.unsupported).toEqual(['2030'])
    expect(result.total).toBe(2)
  })

  it('ignores numbers present in the source, including percentages', () => {
    expect(findUnsupportedNumbers('Emissions fell 12%', 'emissions fell by 12 percent').unsupported).toEqual([])
  })
})

describe('percentile', () => {
  it('returns null on an empty array', () => {
    expect(percentile([], 50)).toBeNull()
  })

  it('uses nearest rank on small arrays', () => {
    expect(percentile([5], 95)).toBe(5)
    expect(percentile([1, 2, 3, 4], 50)).toBe(2)
    expect(percentile([4, 1, 3, 2], 95)).toBe(4)
  })
})

describe('jaccard', () => {
  it('computes intersection over union', () => {
    expect(jaccard(['a', 'b', 'c'], ['b', 'c', 'd'])).toBeCloseTo(0.5)
  })

  it('is 1 for two empty sets', () => {
    expect(jaccard([], [])).toBe(1)
  })
})

describe('text helpers', () => {
  it('counts words ignoring stray punctuation', () => {
    expect(countWords('Hello,  world — again.')).toBe(3)
  })

  it('splits sentences on terminal punctuation', () => {
    expect(splitSentences('One here. Two there! Three?')).toEqual(['One here.', 'Two there!', 'Three?'])
  })
})

describe('checkSocialPost', () => {
  const rules = { platform: 'bluesky' as const, maxChars: 60, title: 'Reefs recover' }

  it('passes a clean draft', () => {
    expect(Object.values(checkSocialPost('Fiji shows that a fishing ban can bring coral back.', rules)).some(Boolean)).toBe(false)
  })

  it('flags each forbidden element', () => {
    expect(checkSocialPost('x'.repeat(61), rules).overLimit).toBe(true)
    expect(checkSocialPost('Read more at https://x.org', rules).url).toBe(true)
    expect(checkSocialPost('Thanks @someone for this', rules).mention).toBe(true)
    expect(checkSocialPost('Good news #coral', rules).hashtag).toBe(true)
    expect(checkSocialPost('Reefs recover, finally', rules).titleRepeated).toBe(true)
    expect(checkSocialPost('One — two — three', rules).extraEmDash).toBe(true)
  })

  it('allows up to two hashtags on Mastodon', () => {
    const m = { ...rules, platform: 'mastodon' as const, maxChars: 500 }
    expect(checkSocialPost('Good news #coral #ocean', m).hashtag).toBe(false)
    expect(checkSocialPost('Good news #coral #ocean #fiji', m).hashtag).toBe(true)
  })
})

describe('checkIntro', () => {
  it('passes a compliant intro', () => {
    const c = checkIntro('Coral is returning to Fiji. Quiet rules can outlast loud promises.')
    expect(Object.values(c).some(Boolean)).toBe(false)
  })

  it('flags banned phrases, em dashes, markdown and sentence count', () => {
    expect(checkIntro('This week, good news. More good news.').bannedPhrase).toBe(true)
    expect(checkIntro('One thing — another. Two.').emDash).toBe(true)
    expect(checkIntro('**Bold** start. Second.').markdown).toBe(true)
    expect(checkIntro('Just one sentence.').sentenceCount).toBe(true)
  })
})

describe('checkPodcast', () => {
  it('measures long sentences and publisher coverage', () => {
    const c = checkPodcast(
      'Welcome back. The Guardian reports that reefs are recovering across the whole Pacific region after years of fishing bans.',
      ['The Guardian', 'Reuters'],
    )
    expect(c.longSentenceShare).toBeCloseTo(0.5)
    expect(c.publisherCoverage).toBeCloseTo(0.5)
    expect(c.markup).toBe(false)
  })

  it('flags stage directions and markdown', () => {
    expect(checkPodcast('[MUSIC] Welcome.', []).markup).toBe(true)
    expect(checkPodcast('## Intro\nWelcome.', []).markup).toBe(true)
  })
})

describe('summarizeCalls', () => {
  it('aggregates outcomes, latency and mean usage', () => {
    const rec = (outcome: CallRecord['outcome'], latencyMs: number, cost: number): CallRecord => ({
      key: 'k', arm: 'a', schema: 's', outcome, parsed: null, content: '', finishReason: null,
      usage: { input: 100, cached: 0, output: 50, reasoning: 20 }, costUsd: cost, latencyMs, at: '',
    })
    const s = summarizeCalls('a', [rec('ok', 100, 0.01), rec('empty', 300, 0.03), rec('skipped', 0, 0)])
    expect(s.calls).toBe(2)
    expect(s.outcomes.ok).toBe(1)
    expect(s.outcomes.empty).toBe(1)
    expect(s.outcomes.skipped).toBe(1)
    expect(s.latencyP50).toBe(100)
    expect(s.meanCostUsd).toBeCloseTo(0.02)
  })
})

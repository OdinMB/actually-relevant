import { describe, it, expect } from 'vitest'
import { gapKey } from '../../../test/contextFixtures.js'
import { halfOf } from './contextScore.js'
import { checkGapKey, checkGapKeyFiles, summarizeGapKey, type GapKeyStory } from './gapKeyCheck.js'

const story = (extra: Partial<GapKeyStory> = {}): GapKeyStory => ({
  slug: 'story-a',
  status: 'published',
  datePublished: new Date('2026-11-14T01:10:00Z'),
  title: 'Story A',
  summary: 'Fires burned 2.88 million hectares — the most since 2015.',
  relevanceReasons: '- Smoke reaches 12 million people.',
  antifactors: null,
  research: null,
  hasResearchFacts: true,
  ...extra,
})

const stories = (...list: GapKeyStory[]) => new Map(list.map(s => [s.slug, s]))

// The fixture key's `stated` need quotes "our words": make the story say them
const withQuote = (extra: Partial<GapKeyStory> = {}) => story({ relevanceReasons: '- In our words, smoke reaches 12 million people.', ...extra })

describe('checkGapKey', () => {
  it('passes a key whose story is published that day, has research facts and states every quote', () => {
    expect(checkGapKey(gapKey(), stories(withQuote()))).toEqual([])
  })

  it('finds a quote after evening out quote marks, dashes and whitespace', () => {
    const key = gapKey({ needs: gapKey().needs.map(n => (n.id === 'stated' ? { ...n, inStory: 'hectares - the  most since 2015' } : n)) })
    expect(checkGapKey(key, stories(story()))).toEqual([])
  })

  it('reports an unknown or unpublished story and nothing else for it', () => {
    expect(checkGapKey(gapKey(), stories())).toEqual(['story-a: no story with this slug'])
    expect(checkGapKey(gapKey(), stories(story({ status: 'rejected', datePublished: null })))).toEqual(['story-a: not published (status rejected)'])
  })

  it('reports another publication day, a story without research facts and a quote our text lacks', () => {
    const errors = checkGapKey(gapKey({ date: '2026-11-13' }), stories(story({ hasResearchFacts: false })))
    expect(errors).toEqual([
      'dated 2026-11-13, published 2026-11-14 (UTC)',
      'no completed research run whose sources hold facts: the context step has nothing to replay',
      'need stated: inStory not found: "our words"',
    ])
  })
})

describe('summarizeGapKey', () => {
  it('counts the needs, the open must needs and how the response stands, with the half', () => {
    expect(summarizeGapKey(gapKey())).toEqual({
      slug: 'story-a',
      title: 'Story A',
      half: halfOf('story-a'),
      needs: 4,
      must: 3,
      openMust: 2,
      response: 'findable',
    })
  })

  it('tells a response our story reports from one no source reports', () => {
    const response = (edit: object) => gapKey({ needs: gapKey().needs.map(n => (n.slot === 'response' ? { ...n, ...edit } : n)) })
    expect(summarizeGapKey(response({ inStory: 'the program' })).response).toBe('in-story')
    expect(summarizeGapKey(response({ example: null })).response).toBe('no-source')
    expect(summarizeGapKey(gapKey({ needs: gapKey().needs.filter(n => n.slot !== 'response') })).response).toBe('no-source')
  })
})

describe('checkGapKeyFiles', () => {
  it('loads every parsed key’s story once and lists format errors before the database’s', async () => {
    const asked: string[][] = []
    const results = await checkGapKeyFiles(
      [
        { file: 'story-a.json', key: gapKey(), errors: ['format first'] },
        { file: 'broken.json', key: null, errors: ['not valid JSON'] },
      ],
      async slugs => {
        asked.push(slugs)
        return stories(withQuote())
      },
    )
    expect(asked).toEqual([['story-a']])
    expect(results.map(r => [r.file, r.summary?.slug ?? null, r.errors])).toEqual([
      ['story-a.json', 'story-a', ['format first']],
      ['broken.json', null, ['not valid JSON']],
    ])
  })

  it('asks the database nothing without a parsed key', async () => {
    expect(await checkGapKeyFiles([], () => Promise.reject(new Error('no database')))).toEqual([])
  })
})

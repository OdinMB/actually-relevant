import { describe, it, expect } from 'vitest'
import { mixFeedStories, parseFeedMix } from './feedMix.js'

describe('parseFeedMix', () => {
  it.each([
    ['heavy', 0],
    ['mostly-heavy', 25],
    ['balanced', 50],
    ['mostly-uplifting', 75],
    ['uplifting', 100],
    [' Uplifting ', 100],
    ['100', 100],
    ['0', 0],
    ['60', 50],
    ['63', 75],
    ['12', 0],
    ['13', 25],
  ])('reads %s as %i, like the site', (raw, expected) => {
    expect(parseFeedMix(raw)).toBe(expected)
  })

  it.each(['101', '-5', '7.5', 'happy', ''])('rejects %s', raw => {
    expect(parseFeedMix(raw)).toBeNull()
  })
})

const at = (id: string, day: number) => ({ id, datePublished: new Date(Date.UTC(2026, 10, day)), dateCrawled: new Date(Date.UTC(2026, 10, day)) })

describe('mixFeedStories', () => {
  const positive = [at('p1', 9), at('p2', 7), at('p3', 5), at('p4', 3)]
  const negative = [at('n1', 8), at('n2', 6), at('n3', 4), at('n4', 2)]

  it('takes the dial share from each pool and sorts newest first', () => {
    expect(mixFeedStories(positive, negative, 4, 75).map(s => s.id)).toEqual(['p1', 'n1', 'p2', 'p3'])
    expect(mixFeedStories(positive, negative, 4, 25).map(s => s.id)).toEqual(['p1', 'n1', 'n2', 'n3'])
    expect(mixFeedStories(positive, negative, 4, 0).map(s => s.id)).toEqual(['n1', 'n2', 'n3', 'n4'])
  })

  it('fills a short pool from the other', () => {
    expect(mixFeedStories([at('p1', 9)], negative, 4, 75).map(s => s.id)).toEqual(['p1', 'n1', 'n2', 'n3'])
  })
})

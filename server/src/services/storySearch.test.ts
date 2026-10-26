import { describe, it, expect, vi } from 'vitest'

vi.mock('../lib/prisma.js', () => ({ default: {} }))
vi.mock('./embedding.js', () => ({ generateSearchEmbedding: vi.fn() }))

const { fuseRankings } = await import('./storySearch.js')

describe('fuseRankings', () => {
  it('ranks an id found by both legs above ids found by one', () => {
    expect(
      fuseRankings([
        ['a', 'b'],
        ['c', 'b'],
      ])[0],
    ).toBe('b')
  })

  it('orders by summed reciprocal rank', () => {
    // a: 1/61 + 1/63, b: 1/62, c: 1/61 + 1/62 → c, a, b
    expect(
      fuseRankings([
        ['c', 'b', 'a'],
        ['a', 'c'],
      ]),
    ).toEqual(['c', 'a', 'b'])
  })

  it('keeps first-seen order on a tie: the first ranking, then the second', () => {
    expect(
      fuseRankings([
        ['a', 'b'],
        ['c', 'd'],
      ]),
    ).toEqual(['a', 'c', 'b', 'd'])
  })

  it('returns the other ranking unchanged when one leg is empty', () => {
    expect(fuseRankings([[], ['x', 'y', 'z']])).toEqual(['x', 'y', 'z'])
    expect(fuseRankings([['x', 'y'], []])).toEqual(['x', 'y'])
    expect(fuseRankings([[], []])).toEqual([])
  })

  it('takes k from the caller', () => {
    // With k = 0: a and c score 1/1 and b 1/2 + 1/2, a three-way tie kept in first-seen order
    expect(
      fuseRankings(
        [
          ['a', 'b'],
          ['c', 'b'],
        ],
        0,
      ),
    ).toEqual(['a', 'b', 'c'])
  })
})

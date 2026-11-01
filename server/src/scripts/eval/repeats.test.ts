import { describe, it, expect } from 'vitest'
import { disagreement, meanRange, repeatDetails, runSchemaName, spread } from './repeats.js'

describe('runSchemaName', () => {
  it("keeps run 1's name, so existing ledger entries stay reachable", () => {
    expect(runSchemaName('assess#abcd1234', 1)).toBe('assess#abcd1234')
  })

  it('gives every later run its own name, so the cache cannot answer it with run 1', () => {
    expect(runSchemaName('assess#abcd1234', 2)).toBe('assess#abcd1234~run2')
    expect(runSchemaName('assess#abcd1234', 3)).not.toBe(runSchemaName('assess#abcd1234', 2))
  })

  it('refuses a run number below 1 or not whole', () => {
    expect(() => runSchemaName('assess', 0)).toThrow(/run/)
    expect(() => runSchemaName('assess', 1.5)).toThrow(/run/)
  })
})

describe('spread', () => {
  it('gives mean, range and sample standard deviation, ignoring missing values', () => {
    const s = spread([0.1, null, -0.1, 0.3])
    expect(s?.n).toBe(3)
    expect(s?.mean).toBeCloseTo(0.1)
    expect(s?.min).toBeCloseTo(-0.1)
    expect(s?.max).toBeCloseTo(0.3)
    expect(s?.sd).toBeCloseTo(0.2)
  })

  it('has no standard deviation for a single value and nothing for none', () => {
    expect(spread([0.4])).toMatchObject({ n: 1, mean: 0.4, sd: null })
    expect(spread([null])).toBeNull()
  })
})

describe('disagreement', () => {
  it('counts stories whose values differ between runs, over stories present in every run', () => {
    // perRun[run][story]
    const d = disagreement([
      [5, 4, null, 'x'],
      [5, 5, 3, 'x'],
    ])
    expect(d).toEqual({ stories: 3, differing: 1, share: 1 / 3 })
  })

  it('works for categories too and has no share without stories', () => {
    expect(disagreement([['a'], ['b'], ['a']])).toEqual({ stories: 1, differing: 1, share: 1 })
    expect(disagreement([[null], [null]])).toEqual({ stories: 0, differing: 0, share: null })
  })
})

describe('meanRange', () => {
  it("averages each story's highest minus lowest rating across runs", () => {
    expect(
      meanRange([
        [5, 4, 6],
        [7, 4, null],
        [6, 4, 8],
      ]),
    ).toBe(1)
  })

  it('is null when no story has a rating in every run', () => {
    expect(meanRange([[null], [3]])).toBeNull()
  })
})

describe('repeatDetails', () => {
  const lines = repeatDetails({
    runs: [
      { ok: 3, shift: -0.1, share: 0.4 },
      { ok: 3, shift: 0.1, share: 0.5 },
    ],
    ratings: [
      [5, 4, 6],
      [5, 5, 6],
    ],
    threshold: 5,
    categories: [
      {
        name: 'issue',
        perRun: [
          ['a', 'b', 'c'],
          ['a', 'b', 'd'],
        ],
      },
    ],
  }).join('\n')

  it('lists every run with its offset and share', () => {
    expect(lines).toMatch(/Run 1: mean offset vs stored -0\.10, share ≥5 40\.0%, 3 parsed/)
    expect(lines).toMatch(/Run 2: mean offset vs stored 0\.10, share ≥5 50\.0%, 3 parsed/)
  })

  it('gives the spread across runs', () => {
    expect(lines).toMatch(/Across 2 runs: mean offset 0\.00 \(-0\.10 to 0\.10, SD 0\.14\); share ≥5 45\.0% \(40\.0% to 50\.0%, SD 7\.1 points\)/)
  })

  it('gives the per-story disagreement, the split flips and each category', () => {
    expect(lines).toMatch(/3 stories rated in every run: rating differs for 1 \(33\.3%\), the ≥5 split flips for 1 \(33\.3%\)/)
    expect(lines).toMatch(/mean spread 0\.33 points/)
    expect(lines).toMatch(/issue differs for 1 of 3 \(33\.3%\)/)
  })

  it('says the criteria pool the runs', () => {
    expect(lines).toMatch(/criteria above pool all 2 runs/)
  })
})

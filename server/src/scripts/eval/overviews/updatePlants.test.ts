import { describe, expect, it } from 'vitest'
import { momentWords, plantCorrections, type CitedFact } from './updatePlants.js'

const fact = (statement: string, sentence: string, moment = '2026-10-01'): CitedFact => ({ statement, sentence, moment })
const STORY_DAY = '2026-10-01'

describe('plantCorrections: wrong-number', () => {
  it('changes a count for the same moment, stated in the planted statement, and the same count in its source words', () => {
    const { planted, refused } = plantCorrections(
      'wrong-number',
      fact('Floods displaced 4,000 people.', 'The floods drove 4,000 people from their homes, officials said.'),
      STORY_DAY,
    )
    expect(refused).toEqual([])
    expect(planted).toEqual([
      {
        statement: 'Floods displaced 6,000 people, as of October 1, 2026.',
        sentence: 'The floods drove 6,000 people from their homes, officials said.',
        change: '4,000 → 6,000',
        replaced: 4000,
      },
    ])
  })

  it('leaves a statement that already states its moment as it is', () => {
    const { planted } = plantCorrections(
      'wrong-number',
      fact('As of October 1, floods displaced 4,000 people.', 'Officials counted 4,000 displaced.'),
      STORY_DAY,
    )
    expect(planted[0]!.statement).toBe('As of October 1, floods displaced 6,000 people.')
    expect(plantCorrections('wrong-number', fact('In July 2026, 40 clinics closed.', '40 clinics shut.', '2026-07'), STORY_DAY).planted[0]!.statement).toBe(
      'In July 2026, 60 clinics closed.',
    )
  })

  it("changes the source words' own rendering of the number by the same factor", () => {
    const { planted } = plantCorrections('wrong-number', fact('The fund holds $4.2 million.', 'It holds 4.2 million dollars.'), STORY_DAY)
    expect(planted[0]).toMatchObject({ sentence: 'It holds 6.3 million dollars.', change: '$4.2 million → $6.3 million', replaced: 4_200_000 })
  })

  it('refuses a day of the month, which would give an impossible date such as March 33', () => {
    const { planted, refused } = plantCorrections(
      'wrong-number',
      fact('Talks resumed on March 22 with 40 delegates.', 'On March 22, 40 delegates sat down again.'),
      STORY_DAY,
    )
    expect(refused).toEqual([{ change: '22 → 33', reason: 'day' }])
    expect(planted.map(p => p.change)).toEqual(['40 → 60'])
    expect(plantCorrections('wrong-number', fact('On 22 March, 1,200 fled.', 'On 22 March, 1,200 fled.'), STORY_DAY).refused[0]!.reason).toBe('day')
  })

  it('refuses a share pushed above 100%, but not a rise already above it', () => {
    expect(plantCorrections('wrong-number', fact('Coverage reached 100% of clinics.', 'All clinics, 100%, are covered.'), STORY_DAY)).toEqual({
      planted: [],
      refused: [{ change: '100% → 150%', reason: 'share' }],
    })
    expect(plantCorrections('wrong-number', fact('Coverage reached 80% of clinics.', '80% of clinics.'), STORY_DAY).refused[0]!.reason).toBe('share')
    expect(plantCorrections('wrong-number', fact('Prices rose 140% this year.', 'Prices are up 140%.'), STORY_DAY).planted[0]!.change).toBe('140% → 210%')
  })

  it('refuses a number that bounds a range or a span, whose meaning the change would alter', () => {
    const { planted, refused } = plantCorrections(
      'wrong-number',
      fact('Losses in 2015–16 reached 40 tonnes.', 'In 2015–16 the losses were 40 tonnes.'),
      STORY_DAY,
    )
    expect(refused).toEqual([{ change: '16 → 24', reason: 'range' }])
    expect(planted.map(p => p.change)).toEqual(['40 → 60'])
    expect(
      plantCorrections('wrong-number', fact('Between 10 and 20 boats sank.', 'Between 10 and 20 boats sank.'), STORY_DAY).refused.map(r => r.reason),
    ).toEqual(['range', 'range'])
    expect(plantCorrections('wrong-number', fact('Some 30-40 boats sank.', '30-40 boats sank.'), STORY_DAY).planted).toEqual([])
  })

  it('refuses a number its source words do not state, so the planted source never holds the planted text alone', () => {
    expect(plantCorrections('wrong-number', fact('Floods displaced 4,000 people.', 'Thousands fled the floods.'), STORY_DAY)).toEqual({
      planted: [],
      refused: [{ change: '4,000 → 6,000', reason: 'sentence' }],
    })
  })
})

describe('plantCorrections: wrong-year', () => {
  it("moves an event's year back by one, a claim the old one rules out, in the statement and the source words", () => {
    const { planted, refused } = plantCorrections(
      'wrong-year',
      fact('The treaty was signed in 2019.', 'Leaders signed the treaty in 2019 in Geneva.'),
      STORY_DAY,
    )
    expect(refused).toEqual([])
    expect(planted).toEqual([
      { statement: 'The treaty was signed in 2018.', sentence: 'Leaders signed the treaty in 2018 in Geneva.', change: '2019 → 2018', replaced: 2019 },
    ])
  })

  it('reads a day of the month as part of the date, not as a figure the year dates', () => {
    const { planted } = plantCorrections('wrong-year', fact('The ceasefire began on March 22, 2025.', 'A ceasefire took hold on March 22, 2025.'), STORY_DAY)
    expect(planted.map(p => p.statement)).toEqual(['The ceasefire began on March 22, 2024.'])
  })

  it("refuses a year after the story's, a forecast a newer report may revise", () => {
    expect(plantCorrections('wrong-year', fact('Cases are expected to peak in 2027.', 'Cases may peak in 2027.'), STORY_DAY).refused).toEqual([
      { change: '2027 → 2026', reason: 'forecast' },
    ])
  })

  it("refuses a year that dates a figure, since another year's figure is no contradiction", () => {
    expect(plantCorrections('wrong-year', fact('In 2025, 40 schools closed.', 'In 2025, 40 schools closed.'), STORY_DAY).refused).toEqual([
      { change: '2025 → 2024', reason: 'period' },
    ])
  })

  it('refuses a year that bounds a range, and one its source words do not state', () => {
    expect(
      plantCorrections('wrong-year', fact('Funding rose between 2024 and 2025.', 'Between 2024 and 2025 funding rose.'), STORY_DAY).refused.map(r => r.reason),
    ).toEqual(['range', 'range'])
    expect(plantCorrections('wrong-year', fact('The treaty was signed in 2019.', 'The treaty is old.'), STORY_DAY).refused).toEqual([
      { change: '2019 → 2018', reason: 'sentence' },
    ])
  })
})

describe('momentWords', () => {
  it('writes a moment at its own precision', () => {
    expect(momentWords('2026-07-02')).toBe('July 2, 2026')
    expect(momentWords('2026-07')).toBe('July 2026')
    expect(momentWords('2026')).toBe('2026')
    expect(momentWords('2026-13')).toBeNull()
    expect(momentWords('soon')).toBeNull()
  })
})

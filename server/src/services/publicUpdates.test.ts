import { describe, it, expect } from 'vitest'
import { publicUpdates, updatesEarlierStoryIds, updatesForReaders } from './publicUpdates.js'
import type { ResearchedSource, ResearchedStory } from './researchedStory.js'

const source = (id: string, origin: ResearchedSource['origin'] = 'source'): ResearchedSource => ({
  id,
  origin,
  outlet: `Outlet ${id}`,
  host: origin === 'earlier' ? null : `${id.toLowerCase()}.example`,
  url: origin === 'earlier' ? null : `https://${id.toLowerCase()}.example/a`,
  title: `Title ${id}`,
  date: '2026-11-14',
  country: null,
  kind: 'news-report',
  storyId: origin === 'earlier' ? 'earlier-1' : null,
  slug: null,
})

const cited = (text: string, ...sourceIds: string[]) => ({ text, citations: sourceIds.map(sourceId => ({ sourceId, sentence: `${sourceId} says so.` })) })

const projection = (over: Partial<ResearchedStory> = {}): ResearchedStory => ({
  paragraphs: [{ sentences: [cited('Fires burned 2.88 million hectares.', 'S0')] }, { sentences: [cited('Smoke closed 40 schools.', 'S1')] }],
  whyThisMatters: [cited('Smoke reaches millions.', 'S1')],
  caveats: [cited('Figures are provisional.', 'E1')],
  quoteSourceId: null,
  sources: [source('S0', 'original'), source('S1'), source('E1', 'earlier')],
  ...over,
})

describe('publicUpdates', () => {
  const at = (day: string) => new Date(`${day}T09:00:00Z`)
  const change = (section: string) => ({ section, from: section, before: cited(`old ${section}`, 'S1'), after: cited(`new ${section}`, 'S5') })
  const research = projection({ sources: [source('S0', 'original'), source('S1'), source('S5'), source('S7')] })

  it('lists the notes of versions not reverted, newest first, each dated by its day with the page sections it changed', () => {
    const updates = publicUpdates([
      { number: 1, kind: 'legacy', status: 'superseded', changes: [], note: null, research, createdAt: at('2026-11-14') },
      {
        number: 2,
        kind: 'update',
        status: 'superseded',
        changes: [change('Story paragraph 2'), change('Summary')],
        note: cited('First.', 'S5'),
        research,
        createdAt: at('2026-11-18'),
      },
      { number: 3, kind: 'update', status: 'reverted', changes: [change('Title')], note: cited('Undone.', 'S6'), research, createdAt: at('2026-11-19') },
      {
        number: 4,
        kind: 'update',
        status: 'current',
        changes: [change('Blurb'), change('Caveat 1')],
        note: cited('Second.', 'S7'),
        research,
        createdAt: at('2026-11-20'),
      },
    ])
    expect(updates).toEqual([
      {
        date: '2026-11-20',
        note: cited('Second.', 'S7'),
        changes: [{ section: 'Caveat 1', before: cited('old Caveat 1', 'S1'), removed: false }],
        sources: [source('S1'), source('S7')],
      },
      {
        date: '2026-11-18',
        note: cited('First.', 'S5'),
        changes: [{ section: 'Story paragraph 2', before: cited('old Story paragraph 2', 'S1'), removed: false }],
        sources: [source('S1'), source('S5')],
      },
    ])
  })

  it('labels each change by where it was in the version before, whose text it shows, so a rewrite after a dropped section is not named twice', () => {
    const updates = publicUpdates([
      {
        number: 2,
        kind: 'update',
        status: 'current',
        changes: [
          { section: 'Story paragraph 2', from: 'Story paragraph 2', before: cited('Smoke closed 40 schools.', 'S1'), after: null },
          { section: 'Story paragraph 2', from: 'Story paragraph 3', before: cited('Rain is forecast.', 'S2'), after: cited('No rain came.', 'S5') },
        ],
        note: cited('Rain did not come.', 'S5'),
        research: projection({ sources: [source('S1'), source('S2'), source('S5')] }),
        createdAt: at('2026-11-18'),
      },
    ])
    expect(updates[0]!.changes).toEqual([
      { section: 'Story paragraph 2', before: cited('Smoke closed 40 schools.', 'S1'), removed: true },
      { section: 'Story paragraph 3', before: cited('Rain is forecast.', 'S2'), removed: false },
    ])
  })

  it('gives each Update the sources its note and earlier texts cite: from its own version, else the version it replaced', () => {
    const updates = publicUpdates([
      { number: 1, kind: 'first', status: 'superseded', changes: [], note: null, research: projection(), createdAt: at('2026-11-14') },
      // An undone update: not what the next one replaced
      {
        number: 2,
        kind: 'update',
        status: 'reverted',
        changes: [],
        note: cited('Undone.', 'S9'),
        research: projection({ sources: [source('S9')] }),
        createdAt: at('2026-11-16'),
      },
      {
        number: 3,
        kind: 'update',
        status: 'current',
        changes: [{ section: 'Caveat 1', from: 'Caveat 1', before: cited('Figures are provisional.', 'E1', 'S9'), after: null }],
        note: cited('Final figures are in.', 'S5'),
        research: projection({ caveats: [], sources: [source('S0', 'original'), source('S1'), source('S5')] }),
        createdAt: at('2026-11-18'),
      },
    ])
    expect(updates).toHaveLength(1)
    // S5 from the update's own version, E1 from the first, which it replaced; S9 only the undone update listed
    expect(updates[0]!.sources.map(s => s.id)).toEqual(['S5', 'E1'])
    expect(updates[0]!.changes[0]!.before).toEqual(cited('Figures are provisional.', 'E1'))
  })

  it('serves an earlier story no longer published without its citations, the others under their current slugs', () => {
    const update = {
      date: '2026-11-18',
      note: cited('Note.', 'E1', 'S5'),
      changes: [{ section: 'Caveat 1', before: cited('Old.', 'E1', 'E2'), removed: false }],
      sources: [source('S5'), source('E1', 'earlier'), { ...source('E2', 'earlier'), storyId: 'earlier-2' }],
    }
    const [served] = updatesEarlierStoryIds([update]).length === 2 ? updatesForReaders([update], new Map([['earlier-2', 'new-slug']])) : []
    expect(served!.note.citations.map(c => c.sourceId)).toEqual(['S5'])
    expect(served!.changes[0]!.before!.citations.map(c => c.sourceId)).toEqual(['E2'])
    expect(served!.sources.map(s => [s.id, s.slug])).toEqual([
      ['S5', null],
      ['E2', 'new-slug'],
    ])
  })
})

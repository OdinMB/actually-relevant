import { describe, it, expect, vi } from 'vitest'
import type { Prisma } from '@prisma/client'
import { inboxPreview, inboxStories, SUBJECT_MAX_CHARS, type InboxStory } from './newsletterInbox.js'

const story = (headline: string, relevance: number | null = 5): InboxStory => ({ headline, relevance })

describe('inboxPreview: the subject', () => {
  it('a weekly issue with one story: the week and its headline', () => {
    expect(inboxPreview('Week 43, 2026', [story('Cities cut smog by a third')]).subject).toBe('Week 43: Cities cut smog by a third')
  })

  it('leads with the most relevant story and counts the others', () => {
    const stories = [story('Rated five', 5), story('Rated eight', 8), story('Rated six', 6), story('Rated three', 3)]
    expect(inboxPreview('Week 7, 2026', stories).subject).toBe('Week 7: Rated eight and 3 more')
  })

  it("breaks a tie in relevance by the issue's own order", () => {
    const stories = [story('First seven', 7), story('First nine', 9), story('Second nine', 9)]
    expect(inboxPreview('Week 7, 2026', stories).subject).toBe('Week 7: First nine and 2 more')
  })

  it('ranks unrated stories below every rated one, and leads with the first when none is rated', () => {
    expect(inboxPreview('Week 7, 2026', [story('Unrated', null), story('Rated zero', 0)]).subject).toBe('Week 7: Rated zero and 1 more')
    expect(inboxPreview('Week 7, 2026', [story('One', null), story('Two', null)]).subject).toBe('Week 7: One and 1 more')
  })

  it('an issue with no story keeps its title as the subject', () => {
    expect(inboxPreview('Week 43, 2026', []).subject).toBe('Week 43, 2026')
  })

  it('an issue whose title is not a week label puts the whole title in front', () => {
    expect(inboxPreview('Climate special', [story('Lead'), story('Other')]).subject).toBe('Climate special: Lead and 1 more')
    expect(inboxPreview('Week 43 recap, 2026', [story('Lead')]).subject).toBe('Week 43 recap, 2026: Lead')
  })

  it('shortens a long lead headline at a word, with an ellipsis, and keeps the count', () => {
    const headline = 'Global coalition of ninety countries agrees to phase out unabated coal power plants by the end of 2035 after marathon talks'
    const { subject } = inboxPreview('Week 43, 2026', [story(headline, 9), story('Other'), story('Third')])

    expect(Array.from(subject).length).toBeLessThanOrEqual(SUBJECT_MAX_CHARS)
    expect(subject.startsWith('Week 43: Global coalition')).toBe(true)
    expect(subject.endsWith('… and 2 more')).toBe(true)
    const kept = subject.slice('Week 43: '.length, subject.indexOf('…'))
    // Whole words only: the kept text is the headline up to a space
    expect(headline.startsWith(kept)).toBe(true)
    expect(headline[kept.length]).toBe(' ')
  })

  it('cuts a single overlong word, and never splits a character made of two code units', () => {
    const word = '🌍'.repeat(200)
    const { subject } = inboxPreview('Week 1, 2026', [story(word)])

    expect(Array.from(subject).length).toBe(SUBJECT_MAX_CHARS)
    expect(subject.endsWith('🌍…')).toBe(true)
    // No lone surrogate: every emoji is whole
    expect(subject).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/)
  })

  it('keeps the last whole word when the room ends just before a space', () => {
    // Room for the headline behind "Week 1: " is 87: 86 characters, then a space
    const headline = `${'a'.repeat(50)} ${'b'.repeat(35)} tail`
    expect(inboxPreview('Week 1, 2026', [story(headline)]).subject).toBe(`Week 1: ${'a'.repeat(50)} ${'b'.repeat(35)}…`)
  })

  it('cuts a long word where the room ends when stopping at the word before would keep under half', () => {
    const headline = `Short ${'x'.repeat(100)}`
    const { subject } = inboxPreview('Week 1, 2026', [story(headline)])
    expect(subject).toBe(`Week 1: Short ${'x'.repeat(80)}…`)
    expect(Array.from(subject).length).toBe(SUBJECT_MAX_CHARS)
  })

  it('keeps a headline that just fits whole', () => {
    const headline = 'x'.repeat(SUBJECT_MAX_CHARS - 'Week 1: '.length)
    expect(inboxPreview('Week 1, 2026', [story(headline)]).subject).toBe(`Week 1: ${headline}`)
  })

  it('keeps the headline readable behind a very long title', () => {
    const title = 'A hand-made special issue whose title alone is longer than any inbox will ever show in its list view'
    const { subject } = inboxPreview(title, [story('Seas rise slower than feared along the Atlantic coast, a new survey finds'), story('Other')])
    expect(subject).toBe(`${title}: Seas rise slower than feared… and 1 more`)
  })

  it('is plain text: quotes, ampersands and angle brackets stay as they are, and line breaks become spaces', () => {
    const { subject } = inboxPreview('Week 2, 2026', [story('Cities & towns: "smog" <falls>\nby half')])
    expect(subject).toBe('Week 2: Cities & towns: "smog" <falls> by half')
  })
})

describe('inboxPreview: the preview text', () => {
  it('names the next two stories by relevance after the lead', () => {
    const stories = [story('Five', 5), story('Nine', 9), story('Seven', 7), story('Eight', 8)]
    expect(inboxPreview('Week 7, 2026', stories).preheader).toBe('Also: Eight · Seven')
  })

  it('names the one other story of a two-story issue', () => {
    expect(inboxPreview('Week 7, 2026', [story('Lead', 9), story('Other', 3)]).preheader).toBe('Also: Other')
  })

  it('is empty for an issue with one story or none', () => {
    expect(inboxPreview('Week 7, 2026', [story('Only')]).preheader).toBe('')
    expect(inboxPreview('Week 7, 2026', []).preheader).toBe('')
  })

  it('is plain text on one line (renderHtml escapes it)', () => {
    expect(inboxPreview('Week 7, 2026', [story('Lead', 9), story('Fish & "chips"\r\n<win>', 1)]).preheader).toBe('Also: Fish & "chips" <win>')
  })
})

describe('inboxStories', () => {
  const ID_A = '3f2b8c1e-0000-4000-8000-00000000000a'
  const ID_B = '3f2b8c1e-0000-4000-8000-00000000000b'

  function fakeClient(rows: { id: string; relevance: number | null }[]) {
    const findMany = vi.fn().mockResolvedValue(rows)
    return { client: { story: { findMany } } as unknown as Prisma.TransactionClient, findMany }
  }

  it("pairs each heading the email shows with its story's stored relevance, in the content's order", async () => {
    const content = [
      '# Planet & Climate {planet-climate}',
      '',
      `## Edited by hand {story:${ID_A}}`,
      'Publisher · [original article](https://news.example/a)',
      '',
      '## Typed by a person',
      '',
      `## Story since deleted {story:${ID_B}}`,
      `## Rated {story:3f2b8c1e-0000-4000-8000-00000000000c}`,
    ].join('\n')
    const { client, findMany } = fakeClient([
      { id: ID_A, relevance: 6 },
      { id: '3f2b8c1e-0000-4000-8000-00000000000c', relevance: 0 },
    ])

    expect(await inboxStories(content, client)).toEqual([
      { headline: 'Edited by hand', relevance: 6 },
      { headline: 'Typed by a person', relevance: null },
      { headline: 'Story since deleted', relevance: null },
      { headline: 'Rated', relevance: 0 },
    ])
    expect(findMany).toHaveBeenCalledWith({
      where: { id: { in: [ID_A, ID_B, '3f2b8c1e-0000-4000-8000-00000000000c'] } },
      select: { id: true, relevance: true },
    })
  })

  it('reads nothing when no heading names a story', async () => {
    const { client, findMany } = fakeClient([])
    expect(await inboxStories('## Unmarked\n\nText.', client)).toEqual([{ headline: 'Unmarked', relevance: null }])
    expect(await inboxStories('', client)).toEqual([])
    expect(findMany).not.toHaveBeenCalled()
  })
})

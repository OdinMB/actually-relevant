import { describe, it, expect, vi } from 'vitest'
import type { Prisma } from '@prisma/client'
import { NEWSLETTER_PREVIEW_AI_MARKER, NEWSLETTER_TOP_LABEL } from '../lib/aiLabelCopy.js'
import { inboxPreview, inboxStories, SUBJECT_MAX_CHARS, type InboxStory } from './newsletterInbox.js'

const story = (headline: string, relevance: number | null = 5): InboxStory => ({ headline, relevance })

describe('inboxPreview: the subject', () => {
  it('a weekly issue with one story: the week and its headline', () => {
    expect(inboxPreview('Week 43, 2026', [story('Cities cut smog by a third')]).subject).toBe('Week 43: Cities cut smog by a third')
  })

  it('leads with the most relevant story, without counting the others', () => {
    const stories = [story('Rated five', 5), story('Rated eight', 8), story('Rated six', 6), story('Rated three', 3)]
    expect(inboxPreview('Week 7, 2026', stories).subject).toBe('Week 7: Rated eight')
  })

  it("breaks a tie in relevance by the issue's own order", () => {
    const stories = [story('First seven', 7), story('First nine', 9), story('Second nine', 9)]
    expect(inboxPreview('Week 7, 2026', stories).subject).toBe('Week 7: First nine')
  })

  it('ranks unrated stories below every rated one, and leads with the first when none is rated', () => {
    expect(inboxPreview('Week 7, 2026', [story('Unrated', null), story('Rated zero', 0)]).subject).toBe('Week 7: Rated zero')
    expect(inboxPreview('Week 7, 2026', [story('One', null), story('Two', null)]).subject).toBe('Week 7: One')
  })

  it('an issue with no story keeps its title as the subject', () => {
    expect(inboxPreview('Week 43, 2026', []).subject).toBe('Week 43, 2026')
  })

  it('an issue whose title is not a week label puts the whole title in front', () => {
    expect(inboxPreview('Climate special', [story('Lead'), story('Other')]).subject).toBe('Climate special: Lead')
    expect(inboxPreview('Week 43 recap, 2026', [story('Lead')]).subject).toBe('Week 43 recap, 2026: Lead')
  })

  it('shortens a long lead headline at a word, with an ellipsis', () => {
    const headline = 'Global coalition of ninety countries agrees to phase out unabated coal power plants by the end of 2035 after marathon talks'
    const { subject } = inboxPreview('Week 43, 2026', [story(headline, 9), story('Other'), story('Third')])

    expect(subject).toBe('Week 43: Global coalition of ninety countries agrees to phase out unabated coal power plants…')
    expect(Array.from(subject).length).toBeLessThanOrEqual(SUBJECT_MAX_CHARS)
  })

  it('gives the lead headline the whole room behind the label, however many stories follow', () => {
    const headline = 'x'.repeat(SUBJECT_MAX_CHARS - 'Week 1: '.length)
    const stories = [story(headline, 9), ...Array.from({ length: 9 }, (_, i) => story(`Other ${i}`, 1))]
    expect(inboxPreview('Week 1, 2026', stories).subject).toBe(`Week 1: ${headline}`)
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
    expect(subject).toBe(`${title}: Seas rise slower than feared…`)
  })

  it('is plain text: quotes, ampersands and angle brackets stay as they are, and line breaks become spaces', () => {
    const { subject } = inboxPreview('Week 2, 2026', [story('Cities & towns: "smog" <falls>\nby half')])
    expect(subject).toBe('Week 2: Cities & towns: "smog" <falls> by half')
  })

  it("puts an edition's label in front, and still fits the subject in its room", () => {
    const label = 'Actually Uplifting · '
    expect(inboxPreview('Week 45, 2026', [story('Cities cut smog by a third')], label).subject).toBe('Actually Uplifting · Week 45: Cities cut smog by a third')
    expect(inboxPreview('Week 45, 2026', [], label).subject).toBe('Actually Uplifting · Week 45, 2026')

    const headline = 'Global coalition of ninety countries agrees to phase out unabated coal power plants by the end of 2035'
    const { subject } = inboxPreview('Week 45, 2026', [story(headline)], label)
    expect(subject).toBe('Actually Uplifting · Week 45: Global coalition of ninety countries agrees to phase out…')
    expect(Array.from(subject).length).toBeLessThanOrEqual(SUBJECT_MAX_CHARS)
  })
})

describe('inboxPreview: the preview text', () => {
  it('opens with the AI marker, then names the next two stories by relevance after the lead', () => {
    const stories = [story('Five', 5), story('Nine', 9), story('Seven', 7), story('Eight', 8)]
    expect(inboxPreview('Week 7, 2026', stories).preheader).toBe('AI-curated: Eight · Seven')
  })

  it('names the one other story of a two-story issue', () => {
    expect(inboxPreview('Week 7, 2026', [story('Lead', 9), story('Other', 3)]).preheader).toBe('AI-curated: Other')
  })

  it("is the email's own top label for an issue with one story, so the subject's AI headline has a label beside it", () => {
    const { subject, preheader } = inboxPreview('Week 7, 2026', [story('Only')])
    expect(subject).toBe('Week 7: Only')
    expect(preheader).toBe('AI selected the stories in this issue and wrote the headlines and summaries.')
    expect(preheader).toBe(`${NEWSLETTER_TOP_LABEL.lead} ${NEWSLETTER_TOP_LABEL.text}`)
  })

  it('is empty for an issue with no story', () => {
    expect(inboxPreview('Week 7, 2026', []).preheader).toBe('')
  })

  it('is plain text on one line (renderHtml escapes it)', () => {
    expect(inboxPreview('Week 7, 2026', [story('Lead', 9), story('Fish & "chips"\r\n<win>', 1)]).preheader).toBe('AI-curated: Fish & "chips" <win>')
  })

  it('takes its marker and the top label from the AI label copy, where label wording lives', async () => {
    expect(NEWSLETTER_PREVIEW_AI_MARKER).toBe('AI-curated:')

    vi.resetModules()
    vi.doMock('../lib/aiLabelCopy.js', async importOriginal => ({
      ...(await importOriginal<typeof import('../lib/aiLabelCopy.js')>()),
      NEWSLETTER_PREVIEW_AI_MARKER: 'Marker:',
      NEWSLETTER_TOP_LABEL: { lead: 'Lead-in:', text: 'Label text.' },
    }))
    try {
      const { inboxPreview: withOtherCopy } = await import('./newsletterInbox.js')
      expect(withOtherCopy('Week 7, 2026', [story('Lead', 9), story('Other', 3)]).preheader).toBe('Marker: Other')
      expect(withOtherCopy('Week 7, 2026', [story('Only')]).preheader).toBe('Lead-in: Label text.')
    } finally {
      vi.doUnmock('../lib/aiLabelCopy.js')
      vi.resetModules()
    }
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

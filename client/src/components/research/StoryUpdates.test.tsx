import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { PublicStoryUpdate, ResearchedSource } from '@shared/types'
import { sectionName, StoryUpdates, updateDay, UpdatedMark, updatedLinkText } from './StoryUpdates'

const source = (id: string, outlet: string): ResearchedSource => ({
  id,
  origin: id === 'S0' ? 'original' : 'source',
  outlet,
  host: `${outlet.toLowerCase()}.example`,
  url: `https://${outlet.toLowerCase()}.example/a`,
  title: 'Title',
  date: '2026-11-17',
  country: null,
  kind: 'news-report',
  storyId: null,
  slug: null,
})

const newer: PublicStoryUpdate = {
  date: '2026-11-18',
  note: { text: 'The death toll was revised to 212 from 180, according to WHO.', citations: [{ sourceId: 'S3', sentence: 'WHO counted 212 deaths.' }] },
  changes: [
    { section: 'Story paragraph 2', before: { text: 'At least 180 people died.', citations: [{ sourceId: 'S1', sentence: '180 died.' }] }, removed: false },
    { section: 'Caveat 2', before: { text: 'The count may rise.', citations: [] }, removed: true },
    { section: 'Title', before: { text: 'Floods kill 180', citations: [] }, removed: false },
  ],
  sources: [source('S1', 'Nation'), source('S3', 'WHO')],
}

const older: PublicStoryUpdate = {
  date: '2026-11-16',
  note: { text: 'Researched with 3 more sources on Nov 16, 2026; the story was rewritten from them.', citations: [] },
  changes: [{ section: 'Story paragraph 1', before: { text: 'The single-source summary.', citations: [] }, removed: false }],
  sources: [],
}

describe('StoryUpdates', () => {
  it('renders nothing for a story never updated', () => {
    const { container } = render(<StoryUpdates updates={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('is a section named Updates, marked as AI-written by its API field, listing the updates newest first with their dates', () => {
    render(<StoryUpdates updates={[newer, older]} />)
    const section = screen.getByRole('region', { name: 'Updates' })
    expect(section).toHaveAttribute('id', 'updates')
    expect(section).toHaveAttribute('data-ai-generated', 'updates')
    const items = within(section).getAllByRole('listitem')
    expect(items.map(i => i.querySelector('time')?.getAttribute('dateTime'))).toEqual(['2026-11-18', '2026-11-16'])
    expect(items[0]).toHaveTextContent('November 18, 2026')
    expect(within(items[0]!).getByText(/The death toll was revised/)).toBeInTheDocument()
    expect(within(items[0]!).getByRole('button', { name: 'Source: WHO' })).toBeInTheDocument()
  })

  it('keeps each earlier text closed under its section, with the citations it carried, and names a removed one', () => {
    render(<StoryUpdates updates={[newer]} />)
    const earlier = screen.getByText('Earlier version of paragraph 2').closest('details')!
    expect(earlier).not.toHaveAttribute('open')
    expect(earlier).toHaveTextContent('At least 180 people died.')
    expect(within(earlier).getByRole('button', { name: 'Source: Nation' })).toBeInTheDocument()
    expect(screen.getByText('Removed: Caveats, point 2').closest('details')).toHaveTextContent('The count may rise.')
    expect(screen.getByText('Earlier version of the headline')).toBeInTheDocument()
  })
})

describe('UpdatedMark', () => {
  it('links to the Updates section, named for screen readers', () => {
    render(<UpdatedMark />)
    const link = screen.getByRole('link', { name: updatedLinkText })
    expect(link).toHaveAttribute('href', '#updates')
    expect(link).toHaveTextContent(/^Updated/)
  })

  it('centers in a box one line of the surrounding text tall, as the chips before it do, its own small text inside', () => {
    render(<UpdatedMark />)
    const link = screen.getByRole('link', { name: updatedLinkText })
    const box = link.parentElement!
    // `1lh` is the line height of the box's own font: the paragraph's, never the mark's smaller text
    expect(box).toHaveClass('inline-flex', 'min-h-[1lh]', 'items-center', 'align-top')
    expect(box.className).not.toMatch(/\btext-(xs|sm)\b/)
    expect(link).toHaveClass('text-xs')
  })
})

describe('sectionName', () => {
  it('names each section where readers saw it, and passes an unknown label through', () => {
    expect(sectionName('Title')).toBe('the headline')
    expect(sectionName('Key quote')).toBe('the key quote')
    expect(sectionName('Story paragraph 3')).toBe('paragraph 3')
    expect(sectionName('Why This Matters 2')).toBe('Why This Matters, point 2')
    expect(sectionName('Caveat 1')).toBe('Caveats, point 1')
    expect(sectionName('Summary')).toBe('Summary')
  })
})

describe('updateDay', () => {
  it('gives the day in UTC as readers read it, and an unreadable day as it came', () => {
    expect(updateDay('2026-11-18')).toBe('November 18, 2026')
    expect(updateDay('2026-11-18', { month: 'short', day: 'numeric', year: 'numeric' })).toBe('Nov 18, 2026')
    expect(updateDay('soon')).toBe('soon')
  })
})

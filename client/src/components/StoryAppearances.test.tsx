import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { axe } from 'vitest-axe'
import type { PublicStoryAppearances } from '@shared/types'
import StoryAppearances from './StoryAppearances'
import { focusRingProblems } from '../test/classes'

const ISSUE = { slug: 'week-43-2026', title: 'Week 43, 2026', edition: 'full' as const, publishedAt: '2026-10-24T04:30:00.000Z', storyCount: 6 }
const EPISODE = {
  id: 'episode-43',
  title: 'W43: Clean air and a new vaccine',
  aiLine: 'Written and voiced by AI.',
  summary: 'Two hosts talk through the week.',
  publishedAt: '2026-10-24T05:00:00.000Z',
  durationSec: 372,
  audioUrl: 'https://audio.example/e.mp3',
  audioBytes: 123,
  transcriptUrl: null,
  stories: [],
  aiGenerated: { fields: ['title', 'summary', 'audioUrl'], digitalSourceType: 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia' },
}

function renderAppearances(appearances: PublicStoryAppearances | undefined) {
  return render(
    <MemoryRouter>
      <StoryAppearances appearances={appearances} />
    </MemoryRouter>,
  )
}

const issueLink = () => screen.getByRole('link', { name: /^Featured in the newsletter/ })
const episodeLink = () => screen.getByRole('link', { name: /^Featured on the podcast/ })

describe('StoryAppearances', () => {
  it.each([
    ['before the answer', undefined],
    ['for a story in neither', { newsletterIssue: null, podcastEpisode: null }],
  ])('shows nothing %s', (_, appearances) => {
    const { container } = renderAppearances(appearances)
    expect(container).toBeEmptyDOMElement()
  })

  it("links the issue's web edition, named by its title and story count", () => {
    renderAppearances({ newsletterIssue: ISSUE, podcastEpisode: null })
    const link = issueLink()
    expect(link).toHaveAttribute('href', '/newsletter/week-43-2026')
    expect(link).toHaveAccessibleName('Featured in the newsletter Week 43, 2026 · 6 stories')
    expect(screen.queryByRole('link', { name: /podcast/ })).toBeNull()
  })

  it('counts a one-story issue in the singular', () => {
    renderAppearances({ newsletterIssue: { ...ISSUE, storyCount: 1 }, podcastEpisode: null })
    expect(issueLink()).toHaveAccessibleName('Featured in the newsletter Week 43, 2026 · 1 story')
  })

  it("links the episode's transcript page, its AI title behind the AI badge, with its length", () => {
    renderAppearances({ newsletterIssue: null, podcastEpisode: EPISODE })
    const link = episodeLink()
    expect(link).toHaveAttribute('href', '/podcast/episode-43/transcript')
    expect(link).toHaveAccessibleName('Featured on the podcast AI-generated W43: Clean air and a new vaccine · 6:12')
    // The badge comes before the title it labels, as on /podcast
    const badge = within(link).getByText('AI-generated').parentElement!
    const title = within(link).getByText(EPISODE.title, { exact: false })
    expect(badge.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByRole('link', { name: /newsletter/ })).toBeNull()
  })

  it('leaves out a length the episode does not have', () => {
    renderAppearances({ newsletterIssue: null, podcastEpisode: { ...EPISODE, durationSec: null } })
    expect(episodeLink()).toHaveAccessibleName('Featured on the podcast AI-generated W43: Clean air and a new vaccine')
  })

  it('lists the issue, then the episode, and passes axe', async () => {
    const { container } = renderAppearances({ newsletterIssue: ISSUE, podcastEpisode: EPISODE })
    const items = within(screen.getByRole('list')).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toContainElement(issueLink())
    expect(items[1]).toContainElement(episodeLink())
    expect(await axe(container)).toHaveNoViolations()
  })

  it('shows only the brand ring on keyboard focus', () => {
    renderAppearances({ newsletterIssue: ISSUE, podcastEpisode: EPISODE })
    expect(focusRingProblems(issueLink())).toEqual([])
    expect(focusRingProblems(episodeLink())).toEqual([])
  })
})

import { useState } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, useLocation } from 'react-router-dom'
import { makePodcast, renderInAdmin } from '../../test/podcasts'

const mockApi = vi.hoisted(() => ({
  usage: vi.fn(),
  active: vi.fn(),
  update: vi.fn(),
  storyPool: vi.fn(),
  delete: vi.fn(),
}))
vi.mock('../../lib/admin-api', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/admin-api')>()),
  adminApi: { podcasts: mockApi },
}))

import { PodcastDetail } from './PodcastDetail'
import { titleEditBlockedReason } from './PodcastTitle'
import { podcastRefetchInterval, PODCAST_POLL_MS } from '../../hooks/usePodcasts'

function Where() {
  const location = useLocation()
  return <output data-testid="where">{location.pathname + location.search}</output>
}

const tab = (name: string) => screen.getByRole('tab', { name: new RegExp(`^${name}`) })
const describedBy = (el: HTMLElement) => document.getElementById(el.getAttribute('aria-describedby') ?? '')

beforeEach(() => {
  vi.clearAllMocks()
  mockApi.usage.mockResolvedValue({ monthToDateChars: 10800, monthlyCap: 32000, typicalEpisodeChars: 4900, maxEpisodeChars: 6200 })
  mockApi.active.mockResolvedValue([])
  mockApi.storyPool.mockResolvedValue({ stories: [], minStories: 4, maxStories: 5 })
})

describe('titleEditBlockedReason', () => {
  it('allows a title edit once there is a script, at rest, before publication', () => {
    expect(titleEditBlockedReason(makePodcast())).toBeNull()
    expect(titleEditBlockedReason(makePodcast({ stage: 'ready' }))).toBeNull()
    expect(titleEditBlockedReason(makePodcast({ stage: 'selected' }))).not.toBeNull()
    expect(titleEditBlockedReason(makePodcast({ inProgress: true }))).not.toBeNull()
    expect(titleEditBlockedReason(makePodcast({ stage: 'ready', status: 'published' }))).not.toBeNull()
    expect(titleEditBlockedReason(makePodcast({ stage: 'ready', publishedAt: '2026-10-12T07:00:00.000Z' }))).not.toBeNull()
  })
})

describe('podcastRefetchInterval', () => {
  it('polls only while the episode is in progress', () => {
    expect(podcastRefetchInterval(makePodcast({ inProgress: true }))).toBe(PODCAST_POLL_MS)
    expect(podcastRefetchInterval(makePodcast())).toBe(false)
    expect(podcastRefetchInterval(undefined)).toBe(false)
  })
})

describe('PodcastDetail tabs', () => {
  it('opens the tab of the current stage and disables the stages not reached', () => {
    renderInAdmin(<PodcastDetail podcast={makePodcast({ stage: 'created', mode: null, awaitingReview: false })} />)
    expect(tab('Stories').getAttribute('aria-selected')).toBe('true')
    expect(tab('Script').hasAttribute('disabled') || tab('Script').getAttribute('aria-disabled') === 'true').toBe(true)
    expect(screen.getByRole('button', { name: 'Fully automated' })).toBeTruthy()
  })

  it('opens the script editor for a scripted episode at rest', () => {
    renderInAdmin(<PodcastDetail podcast={makePodcast()} />)
    expect(tab('Script').getAttribute('aria-selected')).toBe('true')
    expect(screen.getByLabelText('Episode summary')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Approve and voice' })).toBeTruthy()
  })

  it('keeps the tab named in the URL and writes a chosen tab back to it', () => {
    renderInAdmin(<><PodcastDetail podcast={makePodcast()} /><Where /></>, { route: '/admin/podcasts/pod-1?tab=stories' })
    expect(tab('Stories').getAttribute('aria-selected')).toBe('true')
    fireEvent.click(tab('Audio'))
    expect(tab('Audio').getAttribute('aria-selected')).toBe('true')
    expect(screen.getByTestId('where').textContent).toBe('/admin/podcasts/pod-1?tab=audio')
  })

  it('offers Write script on the Script tab at the stories review', () => {
    renderInAdmin(<PodcastDetail podcast={makePodcast({ stage: 'selected', dialogue: null, script: '' })} />, { route: '/?tab=script' })
    expect(tab('Script').getAttribute('aria-selected')).toBe('true')
    expect((screen.getByRole('button', { name: 'Write script' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('drops ?tab= when a run starts, so the page shows the running stage', async () => {
    function Episode() {
      const [podcast, setPodcast] = useState(makePodcast())
      const start = () => setPodcast(makePodcast({ inProgress: true, awaitingReview: false, activity: 'Voicing' }))
      return <><button onClick={start}>Simulate run start</button><PodcastDetail podcast={podcast} /><Where /></>
    }
    renderInAdmin(<Episode />, { route: '/admin/podcasts/pod-1?tab=stories' })
    expect(tab('Stories').getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Simulate run start' }))
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/admin/podcasts/pod-1'))
    expect(tab('Audio').getAttribute('aria-selected')).toBe('true')
  })

  it('while a run works: a spinner on the running tab, its activity announced, and no approval', () => {
    renderInAdmin(<PodcastDetail podcast={makePodcast({ stage: 'scripted', inProgress: true, awaitingReview: false, activity: 'Voicing' })} />)
    expect(tab('Audio').getAttribute('aria-selected')).toBe('true')
    expect(tab('Audio').querySelector('[data-state="running"]')).toBeTruthy()
    expect(screen.getAllByRole('status').some(el => el.textContent?.includes('Voicing'))).toBe(true)
    expect(screen.queryByRole('button', { name: /Approve|Resume|Start over/ })).toBeNull()
  })

  it('shows the script read-only while a run works on the episode', () => {
    renderInAdmin(<PodcastDetail podcast={makePodcast({ stage: 'voiced', inProgress: true, awaitingReview: false, activity: 'Assembling and uploading' })} />)
    fireEvent.click(tab('Script'))
    expect(screen.getByText('HOST A: Hello.')).toBeTruthy()
    expect(screen.queryByLabelText('Episode summary')).toBeNull()
  })

  it('shows a blocked episode\'s reason with Resume in the bar', () => {
    renderInAdmin(<PodcastDetail podcast={makePodcast({ awaitingReview: false, blockedAt: '2026-10-10T07:00:00.000Z', blockedReason: 'the dialogue is still invalid' })} />)
    expect(screen.getByRole('alert').textContent).toContain('the dialogue is still invalid')
    expect(within(screen.getByRole('region', { name: 'Episode actions' })).getByRole('button', { name: 'Resume' })).toBeTruthy()
  })
})

describe('PodcastDetail unsaved changes', () => {
  it('asks before a tab switch discards edits, and stays on cancel', async () => {
    renderInAdmin(<PodcastDetail podcast={makePodcast()} />)
    fireEvent.change(screen.getByLabelText('Episode summary'), { target: { value: 'Changed.' } })
    fireEvent.click(tab('Stories'))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(tab('Script').getAttribute('aria-selected')).toBe('true')
    expect((screen.getByLabelText('Episode summary') as HTMLTextAreaElement).value).toBe('Changed.')
  })

  it('switches once the discard is confirmed, asking only once', async () => {
    renderInAdmin(<><PodcastDetail podcast={makePodcast()} /><Where /></>, { route: '/admin/podcasts/pod-1' })
    fireEvent.change(screen.getByLabelText('Episode summary'), { target: { value: 'Changed.' } })
    fireEvent.click(tab('Stories'))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Discard changes' }))
    await waitFor(() => expect(tab('Stories').getAttribute('aria-selected')).toBe('true'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByTestId('where').textContent).toBe('/admin/podcasts/pod-1?tab=stories')
  })

  it('switches without asking when nothing is unsaved', () => {
    renderInAdmin(<PodcastDetail podcast={makePodcast()} />)
    fireEvent.click(tab('Stories'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(tab('Stories').getAttribute('aria-selected')).toBe('true')
  })

  it('holds an in-app link while edits are unsaved, and follows it once confirmed', async () => {
    renderInAdmin(<><Link to="/admin/podcasts">Back to Podcasts</Link><PodcastDetail podcast={makePodcast()} /><Where /></>, { route: '/admin/podcasts/pod-1' })
    fireEvent.change(screen.getByLabelText('Episode summary'), { target: { value: 'Changed.' } })
    fireEvent.click(screen.getByRole('link', { name: 'Back to Podcasts' }))
    const dialog = await screen.findByRole('dialog')
    expect(screen.getByTestId('where').textContent).toBe('/admin/podcasts/pod-1')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard changes' }))
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/admin/podcasts'))
  })

  it('holds the browser Back button while edits are unsaved, staying on cancel and leaving once confirmed', async () => {
    const { router } = renderInAdmin(<><PodcastDetail podcast={makePodcast()} /><Where /></>, { history: ['/admin/podcasts', '/admin/podcasts/pod-1'] })
    fireEvent.change(screen.getByLabelText('Episode summary'), { target: { value: 'Changed.' } })

    await act(() => router.navigate(-1))
    const dialog = await screen.findByRole('dialog')
    expect(screen.getByTestId('where').textContent).toBe('/admin/podcasts/pod-1')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByTestId('where').textContent).toBe('/admin/podcasts/pod-1')
    expect((screen.getByLabelText('Episode summary') as HTMLTextAreaElement).value).toBe('Changed.')

    await act(() => router.navigate(-1))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Discard changes' }))
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/admin/podcasts'))
  })

  it('lets Back through at once when nothing is unsaved', async () => {
    const { router } = renderInAdmin(<><PodcastDetail podcast={makePodcast()} /><Where /></>, { history: ['/admin/podcasts', '/admin/podcasts/pod-1'] })
    await act(() => router.navigate(-1))
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/admin/podcasts'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('leaves without asking after the episode is deleted, though its edits were unsaved', async () => {
    mockApi.delete.mockResolvedValue(undefined)
    renderInAdmin(<><PodcastDetail podcast={makePodcast()} /><Where /></>, { route: '/admin/podcasts/pod-1' })
    fireEvent.change(screen.getByLabelText('Episode summary'), { target: { value: 'Changed.' } })
    fireEvent.click(within(screen.getByRole('region', { name: 'Episode actions' })).getByRole('button', { name: 'Delete' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/admin/podcasts'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

describe('PodcastDetail title', () => {
  it('edits the title inline: Enter saves', async () => {
    mockApi.update.mockResolvedValue(makePodcast({ title: 'W41: New' }))
    renderInAdmin(<PodcastDetail podcast={makePodcast()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit title' }))
    const field = screen.getByLabelText('Title')
    await userEvent.clear(field)
    await userEvent.type(field, 'W41: New{Enter}')
    await waitFor(() => expect(mockApi.update).toHaveBeenCalledWith('pod-1', { title: 'W41: New' }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit title' })))
  })

  it('Escape cancels the edit without saving and returns focus to the pencil', () => {
    renderInAdmin(<PodcastDetail podcast={makePodcast()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit title' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Something else' } })
    fireEvent.keyDown(screen.getByLabelText('Title'), { key: 'Escape' })
    expect(screen.queryByLabelText('Title')).toBeNull()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('W41: Clean air and vaccines')
    expect(mockApi.update).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit title' }))
  })

  it('keeps the pencil inert, with its reason, on a published episode', () => {
    renderInAdmin(<PodcastDetail podcast={makePodcast({ stage: 'ready', status: 'published', publishedAt: '2026-10-12T07:00:00.000Z', awaitingReview: false })} />)
    const pencil = screen.getByRole('button', { name: 'Edit title' })
    expect(pencil.getAttribute('aria-disabled')).toBe('true')
    expect(describedBy(pencil)?.textContent).toBe(titleEditBlockedReason(makePodcast({ status: 'published' })))
    fireEvent.click(pencil)
    expect(screen.queryByLabelText('Title')).toBeNull()
  })
})

describe('PodcastDetail "edited by a person" chip', () => {
  it('sends the flag when the chip is changed', async () => {
    mockApi.update.mockResolvedValue(makePodcast({ humanEdited: true }))
    renderInAdmin(<PodcastDetail podcast={makePodcast()} />)
    fireEvent.click(screen.getByLabelText('Edited by a person'))
    await waitFor(() => expect(mockApi.update).toHaveBeenCalledWith('pod-1', { humanEdited: true }))
  })

  it('explains itself in a tooltip that opens on keyboard focus and describes the checkbox', () => {
    renderInAdmin(<PodcastDetail podcast={makePodcast()} />)
    const box = screen.getByLabelText('Edited by a person')
    const tip = describedBy(box)
    expect(tip?.getAttribute('role')).toBe('tooltip')
    expect(tip?.parentElement?.className).toContain('hidden')
    fireEvent.focus(box)
    expect(tip?.parentElement?.className).not.toContain('hidden')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(tip?.parentElement?.className).toContain('hidden')
  })

  it('stays changeable on a published episode', () => {
    renderInAdmin(<PodcastDetail podcast={makePodcast({ stage: 'ready', status: 'published', publishedAt: '2026-10-12T07:00:00.000Z', awaitingReview: false })} />)
    expect((screen.getByLabelText('Edited by a person') as HTMLInputElement).disabled).toBe(false)
  })
})

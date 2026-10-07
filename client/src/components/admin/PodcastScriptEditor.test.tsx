import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { makeDialogue, makePodcast, renderInAdmin } from '../../test/podcasts'

const mockApi = vi.hoisted(() => ({ saveScript: vi.fn(), active: vi.fn(), resume: vi.fn(), usage: vi.fn() }))
vi.mock('../../lib/admin-api', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/admin-api')>()),
  adminApi: { podcasts: mockApi },
}))

import { ApiError } from '../../lib/admin-api'
import { PodcastScriptEditor, buildScriptEdit } from './PodcastScriptEditor'

beforeEach(() => {
  vi.clearAllMocks()
  mockApi.active.mockResolvedValue([])
  mockApi.usage.mockResolvedValue({ monthToDateChars: 0, monthlyCap: 32000, typicalEpisodeChars: 4900, maxEpisodeChars: 6200 })
})

describe('buildScriptEdit', () => {
  it('keeps the structure and speakers and takes the edited text', () => {
    const dialogue = makeDialogue()
    const texts = dialogue.segments.map(s => s.turns.map(t => t.text))
    texts[1][0] = 'Rewritten.'
    const edit = buildScriptEdit(dialogue, texts, 'New summary.')
    expect(edit.episodeSummary).toBe('New summary.')
    expect(edit.segments[1]).toEqual({ kind: 'story', storyRef: 1, turns: [{ speaker: 'HOST_B', text: 'Rewritten.' }, dialogue.segments[1].turns[1]] })
    expect(edit).not.toHaveProperty('episodeTitle')
  })
})

describe('PodcastScriptEditor', () => {
  it('labels each turn with its speaker, which cannot be edited', () => {
    renderInAdmin(<PodcastScriptEditor podcast={makePodcast()} />)
    expect(screen.getAllByLabelText('Host A').length).toBe(3)
    expect(screen.getAllByLabelText('Host B').length).toBe(3)
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('saves the edit and shows the warnings it came back with', async () => {
    mockApi.saveScript.mockResolvedValue({ podcast: makePodcast(), warnings: ['segment 3 (story 2): short bridge'] })
    renderInAdmin(<PodcastScriptEditor podcast={makePodcast()} />)
    fireEvent.change(screen.getAllByLabelText('Host A')[2], { target: { value: 'And now, vaccines.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save script' }))
    await waitFor(() => expect(mockApi.saveScript).toHaveBeenCalled())
    expect(mockApi.saveScript.mock.calls[0][1].segments[2].turns[0]).toEqual({ speaker: 'HOST_A', text: 'And now, vaccines.' })
    expect(await screen.findByText('segment 3 (story 2): short bridge')).toBeTruthy()
  })

  it('keeps approval disabled until the edits are saved or discarded', () => {
    renderInAdmin(<PodcastScriptEditor podcast={makePodcast()} />)
    const approve = screen.getByRole('button', { name: 'Approve and voice' }) as HTMLButtonElement
    expect(approve.disabled).toBe(false)
    fireEvent.change(screen.getByLabelText('Episode summary'), { target: { value: 'Changed.' } })
    expect(approve.disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    expect(approve.disabled).toBe(false)
  })

  it('asks for the cost before approving the script, and sends nothing on cancel', async () => {
    renderInAdmin(<PodcastScriptEditor podcast={makePodcast()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Approve and voice' }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(mockApi.resume).not.toHaveBeenCalled()
  })

  it('shows the errors of a refused save', async () => {
    mockApi.saveScript.mockRejectedValue(new ApiError(422, 'contains a URL', { errors: ['segment 2 (story 1), turn 1: contains a URL'], warnings: [] }))
    renderInAdmin(<PodcastScriptEditor podcast={makePodcast()} />)
    fireEvent.change(screen.getByLabelText('Episode summary'), { target: { value: 'Changed.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save script' }))
    expect((await screen.findByRole('alert')).textContent).toContain('contains a URL')
  })
})

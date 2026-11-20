import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { AdminOverviewDecision, AdminOverviewDetail, AdminOverviewEntry } from '@shared/types'
import charterLimits from '@shared/overviewCharterLimits.json'
import { ApiError } from '../../lib/admin-api'
import { renderAdminRoutes } from '../../test/admin'
import OverviewDetailPage from './OverviewDetailPage'

const mockApi = vi.hoisted(() => ({
  overviews: {
    get: vi.fn(),
    detach: vi.fn(),
    setRole: vi.fn(),
    retitle: vi.fn(),
    recenter: vi.fn(),
    setFrozen: vi.fn(),
    setHidden: vi.fn(),
    setClosed: vi.fn(),
    undo: vi.fn(),
  },
}))

vi.mock('../../lib/admin-api', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/admin-api')>()),
  adminApi: mockApi,
}))

function entry(over: Partial<AdminOverviewEntry> = {}): AdminOverviewEntry {
  return {
    id: 'e1',
    storyId: 's1',
    story: { id: 's1', title: 'Cases rise in Bunia', status: 'published', datePublished: '2026-11-02T00:00:00.000Z' },
    role: 'routine',
    roleKind: null,
    status: 'active',
    joinedBy: 'pipeline',
    joinedAt: '2026-11-02T03:00:00.000Z',
    detachedBy: null,
    detachReason: null,
    detachedAt: null,
    locked: false,
    shared: {
      cause: { story: 'the Ebola outbreak', other: 'Ebola cases' },
      place: { story: 'Bunia', other: 'Ituri' },
      end: { story: 'until it is declared over', other: 'declared over' },
    },
    confidence: 0.9,
    model: 'gpt-6-luna',
    promptVersion: 'v1',
    decisionId: 'd-link',
    ...over,
  }
}

function decision(over: Partial<AdminOverviewDecision> = {}): AdminOverviewDecision {
  return {
    id: 'd1',
    kind: 'link',
    outcome: 'joined',
    storyId: 's1',
    storyTitle: 'Cases rise in Bunia',
    actor: 'pipeline',
    actorName: null,
    createdAt: '2026-11-02T03:00:00.000Z',
    undoneAt: null,
    undoneByName: null,
    costUsd: 0.002,
    model: 'gpt-6-luna',
    confidence: 0.9,
    move: null,
    inputs: {},
    answer: {},
    undoable: true,
    ...over,
  }
}

const quiet = decision({ id: 'd4', kind: 'status', outcome: 'quiet', storyId: null, move: { from: 'open', to: 'quiet', reason: 'quiet' }, undoable: false })

function detail(over: Partial<AdminOverviewDetail> = {}): AdminOverviewDetail {
  return {
    id: 'o1',
    title: 'Ebola in Ituri',
    slug: null,
    scope: 'ongoing',
    status: 'open',
    closedReason: null,
    frozen: false,
    hidden: false,
    public: true,
    entries: 1,
    foundedAt: '2026-11-01T00:00:00.000Z',
    lastEntryAt: '2026-11-02T00:00:00.000Z',
    issue: null,
    charter: { in: 'The Ebola outbreak in Ituri.', out: ['Ebola in Uganda'], endEvent: 'The ministry declares it over' },
    charterModel: 'gpt-6.1-sol',
    closingSince: null,
    closedAt: null,
    entriesAtLastReview: 0,
    reviewedAt: null,
    recentering: {
      automated: 0,
      limit: 2,
      lockDays: 180,
      recenteredAt: null,
      recenteredBy: null,
      lockedUntil: null,
      lockedBy: null,
      lockedOut: [],
      signals: { wider: 0, centerMoved: 0 },
      anchor: {
        standIns: false,
        entries: [
          { entryId: 'e1', storyId: 's1', title: 'Cases rise in Bunia', founding: true },
          { entryId: 'e3', storyId: 's3', title: 'Vaccination begins', founding: false },
        ],
      },
      history: [],
    },
    on: true,
    members: [
      entry(),
      entry({
        id: 'e2',
        storyId: 's2',
        story: { id: 's2', title: 'An older report', status: 'published', datePublished: '2026-11-01T00:00:00.000Z' },
        status: 'detached',
        detachReason: 'review',
        detachedAt: '2026-11-03T00:00:00.000Z',
      }),
    ],
    stands: [
      {
        id: 'v1',
        number: 1,
        status: 'current',
        asOf: '2026-11-02T00:00:00.000Z',
        writtenAt: '2026-11-02T04:00:00.000Z',
        model: 'gpt-6-luna',
        promptVersion: 'v1',
        sentences: [
          {
            text: 'Cases rose to 120.',
            facts: [
              {
                id: 'f1',
                gone: false,
                storyId: 's1',
                statement: 'Cases rose to 120.',
                supportingSentence: 'Cases rose to 120.',
                verdict: 'supported',
                status: 'demoted',
                slot: null,
                outlet: 'Example',
                url: 'https://example.org/a',
                usable: false,
              },
              { id: 'f2', gone: true },
            ],
          },
        ],
        doing: [],
        drops: [{ label: 'Sentence 2', cause: 'fact check', problem: 'unsupported' }],
        checked: 2,
        failed: 1,
      },
    ],
    decisions: [
      decision({
        id: 'd3',
        kind: 'editor_retitle',
        outcome: 'retitled',
        storyId: null,
        storyTitle: null,
        actor: 'u1',
        actorName: 'Odin',
        costUsd: 0,
        model: null,
        confidence: null,
      }),
      decision({ id: 'd2', kind: 'stands', outcome: 'written', undoable: false }),
      quiet,
      decision(),
    ],
    decisionsTotal: 4,
    statusHistory: [quiet],
    ...over,
  }
}

const renderPage = () => renderAdminRoutes([{ path: '/admin/overviews/:id', element: <OverviewDetailPage /> }], { history: ['/admin/overviews/o1'] })

describe('OverviewDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.overviews.get.mockResolvedValue(detail())
    for (const fn of Object.values(mockApi.overviews)) if (fn !== mockApi.overviews.get) fn.mockResolvedValue({ decisionId: 'd9' })
  })

  it('shows the charter, the entries with their judgment, the stands with each fact as it stands, and the status history', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { level: 1, name: 'Ebola in Ituri' })).toBeInTheDocument()
    expect(screen.getByText('Ebola in Uganda')).toBeInTheDocument()
    const active = screen.getByRole('list', { name: 'Active entries' })
    fireEvent.click(within(active).getByRole('button', { name: /Show judgment/ }))
    expect(within(active).getByText('Bunia')).toBeVisible()
    expect(within(active).getByText(/Confidence 90%/)).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Detached entries' })).getByText(/Detached by a review/)).toBeInTheDocument()
    expect(screen.getByText('Demoted')).toBeInTheDocument()
    expect(screen.getByText('Deleted since')).toBeInTheDocument()
    expect(screen.getByText(/Sentence 2: fact check/)).toBeInTheDocument()
    const history = screen.getByRole('heading', { name: 'Status history' }).closest('section') as HTMLElement
    expect(within(history).getByText(/Status: open to quiet/)).toBeInTheDocument()
  })

  it('says when the log shows only the newest decisions, and keeps every move in the status history', async () => {
    const older = decision({ id: 'd0', kind: 'status', outcome: 'open', storyId: null, move: { from: 'quiet', to: 'open', reason: 'active' }, undoable: false })
    mockApi.overviews.get.mockResolvedValue(detail({ decisionsTotal: 250, statusHistory: [quiet, older] }))
    renderPage()
    expect(await screen.findByText('The newest 4 of 250 decisions.')).toBeInTheDocument()
    const history = screen.getByRole('heading', { name: 'Status history' }).closest('section') as HTMLElement
    expect(within(history).getByText(/Status: quiet to open \(active\)/)).toBeInTheDocument()
  })

  it('offers Undo only on what can be undone, and undoes after a confirmation', async () => {
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Ebola in Ituri' })
    const log = screen.getByRole('heading', { name: 'Decision log' }).closest('section') as HTMLElement
    expect(within(log).getAllByRole('button', { name: /^Undo/ })).toHaveLength(2)
    expect(within(log).getByText('Odin')).toBeInTheDocument()
    fireEvent.click(within(log).getAllByRole('button', { name: /^Undo/ })[1]!)
    expect(await screen.findByRole('heading', { name: 'Undo this decision?' })).toBeInTheDocument()
    expect(screen.getByText(/never links it here again/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(mockApi.overviews.undo).toHaveBeenCalledWith('d1'))
    expect(await screen.findByText('Decision undone')).toBeInTheDocument()
  })

  it("shows the server's reason when it refuses an undo", async () => {
    mockApi.overviews.undo.mockRejectedValue(new ApiError(409, 'The overview changed meanwhile: reload the page and try again'))
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Ebola in Ituri' })
    fireEvent.click(screen.getAllByRole('button', { name: /^Undo/ })[0]!)
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(await screen.findByText('The overview changed meanwhile: reload the page and try again')).toBeInTheDocument()
  })

  it('sets an entry’s role only on its button, never on a change of the select, and detaches it after a confirmation', async () => {
    renderPage()
    const select = await screen.findByLabelText('Role of Cases rise in Bunia')
    const set = screen.getByRole('button', { name: /^Set role.*Cases rise in Bunia/ })
    // Unchanged, the button says why it does nothing
    fireEvent.click(set)
    // Moving through the options (arrow keys fire change events) writes nothing
    fireEvent.change(select, { target: { value: 'turning_point:setback' } })
    fireEvent.change(select, { target: { value: 'turning_point:response' } })
    expect(mockApi.overviews.setRole).not.toHaveBeenCalled()
    fireEvent.click(set)
    await waitFor(() => expect(mockApi.overviews.setRole).toHaveBeenCalledWith('o1', 'e1', 'turning_point', 'response'))
    expect(mockApi.overviews.setRole).toHaveBeenCalledTimes(1)
    expect(select).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: /^Detach.*Cases rise in Bunia/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Detach' }))
    await waitFor(() => expect(mockApi.overviews.detach).toHaveBeenCalledWith('o1', 'e1'))
  })

  it('retitles with the title trimmed, and refuses a blank one', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Retitle' }))
    const field = screen.getByLabelText('Title')
    fireEvent.change(field, { target: { value: '   ' } })
    expect(screen.getByText('A title is needed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save title' })).toBeDisabled()
    fireEvent.change(field, { target: { value: '  Ebola in North Kivu  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save title' }))
    await waitFor(() => expect(mockApi.overviews.retitle).toHaveBeenCalledWith('o1', 'Ebola in North Kivu'))
  })

  it('shows a charter with no end event, the count of automatic re-centers, the lock, and the charter history', async () => {
    const charter = detail().charter
    const wider = { in: 'The Ebola outbreak in eastern Congo.', out: [], endEvent: null }
    mockApi.overviews.get.mockResolvedValue(
      detail({
        charter: wider,
        recentering: {
          ...detail().recentering,
          automated: 2,
          recenteredAt: '2026-11-05T00:00:00.000Z',
          recenteredBy: 'editor',
          lockedUntil: '2099-05-04T00:00:00.000Z',
          lockedBy: 'editor',
          signals: { wider: 3, centerMoved: 1 },
          history: [
            {
              id: 'r1',
              kind: 'editor_recenter',
              actor: 'u1',
              actorName: 'Odin',
              createdAt: '2026-11-05T00:00:00.000Z',
              undoneAt: null,
              anchorConfirmed: true,
              title: { from: 'Ebola in Ituri', to: 'Ebola in eastern Congo' },
              charter: { from: charter, to: wider },
            },
          ],
        },
      }),
    )
    renderPage()
    expect(await screen.findByText('No end event: it closes only by fading')).toBeInTheDocument()
    expect(screen.getByText(/Automatic re-centers: 2 of 2: only an editor can re-center it now/)).toBeInTheDocument()
    expect(screen.getByText(/No automatic re-center until May 4, 2099, after an editor's re-center/)).toBeInTheDocument()
    // At the limit the signals are still shown, so the editor sees stories pointing past the charter
    expect(screen.getByText('Since the last re-center: 3 stories pointed past the charter, 1 story reported that its center moved')).toBeInTheDocument()
    const history = within(screen.getByRole('list', { name: 'Charter history' }))
    expect(history.getByText(/Odin, anchor confirmed/)).toBeInTheDocument()
    expect(history.getByText('The ministry declares it over')).toBeInTheDocument()
    // OUT emptied and the end event dropped
    expect(history.getAllByText('none')).toHaveLength(2)
  })

  it('edits the charter: lists the anchor, saves only once it is confirmed, allows no end event, and sends the whole charter', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit charter' }))
    const panel = within(await screen.findByRole('dialog'))
    expect(panel.getByRole('heading', { name: /This overview's anchor/ })).toBeInTheDocument()
    const anchor = within(panel.getByRole('list', { name: 'Anchor stories' }))
    expect(anchor.getByText('Founding')).toBeInTheDocument()
    expect(anchor.getByText('Vaccination begins')).toBeInTheDocument()
    const save = panel.getByRole('button', { name: 'Save' })

    fireEvent.change(panel.getByLabelText(/^In/), { target: { value: '  ' } })
    expect(panel.getByText('Say what the overview is about')).toBeInTheDocument()
    // The server's limits, read from the file it reads them from
    fireEvent.change(panel.getByLabelText(/^In/), { target: { value: 'x'.repeat(charterLimits.inChars + 1) } })
    expect(panel.getByText(`At most ${charterLimits.inChars} characters`)).toBeInTheDocument()
    fireEvent.change(panel.getByLabelText('Ends when'), { target: { value: 'x'.repeat(charterLimits.endEventChars + 1) } })
    expect(panel.getByText(`At most ${charterLimits.endEventChars} characters`)).toBeInTheDocument()
    fireEvent.change(panel.getByLabelText(/^In/), { target: { value: ' The Ebola outbreak in eastern Congo. ' } })
    fireEvent.change(panel.getByLabelText(/^Out/), { target: { value: 'Ebola in Uganda\n\n Mpox ' } })
    fireEvent.change(panel.getByLabelText('Ends when'), { target: { value: ' ' } })
    expect(panel.getByText(/Name the end event, or tick/)).toBeInTheDocument()
    fireEvent.click(panel.getByLabelText('No end event: it closes only by fading'))
    expect(panel.getByLabelText('Ends when')).toBeDisabled()
    // Unconfirmed, it does not save, and says why
    expect(save).toBeDisabled()
    expect(save).toHaveAccessibleDescription(/needs the anchor box ticked/)
    fireEvent.click(panel.getByLabelText(/The new charter still covers them/))
    expect(save).toBeEnabled()
    fireEvent.click(save)
    // With the title and charter the form was opened on, so the server refuses it when a review changed them since
    await waitFor(() =>
      expect(mockApi.overviews.recenter).toHaveBeenCalledWith('o1', {
        title: 'Ebola in Ituri',
        in: 'The Ebola outbreak in eastern Congo.',
        out: ['Ebola in Uganda', 'Mpox'],
        endEvent: null,
        anchorConfirmed: true,
        basedOn: { title: 'Ebola in Ituri', charter: detail().charter },
      }),
    )
    expect(await screen.findByText('Charter saved')).toBeInTheDocument()
  })

  it('offers no charter edit on a closed overview', async () => {
    mockApi.overviews.get.mockResolvedValue(detail({ status: 'closed', closedReason: 'faded', closedAt: '2026-11-04T00:00:00.000Z' }))
    renderPage()
    expect(await screen.findByRole('button', { name: 'Edit charter' })).toBeDisabled()
    expect(screen.getByText('Reopen the overview to edit its charter.')).toBeInTheDocument()
  })

  it('freezes, hides and closes (after a confirmation), and reopens a closed one', async () => {
    const { unmount } = renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Freeze' }))
    await waitFor(() => expect(mockApi.overviews.setFrozen).toHaveBeenCalledWith('o1', true))
    fireEvent.click(screen.getByRole('button', { name: 'Hide from readers' }))
    await waitFor(() => expect(mockApi.overviews.setHidden).toHaveBeenCalledWith('o1', true))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Close overview' }))
    await waitFor(() => expect(mockApi.overviews.setClosed).toHaveBeenCalledWith('o1', true))
    unmount()

    mockApi.overviews.get.mockResolvedValue(
      detail({ status: 'closed', closedReason: 'editor', closedAt: '2026-11-04T00:00:00.000Z', frozen: true, hidden: true }),
    )
    renderPage()
    expect(await screen.findByText(/an editor closed it/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }))
    await waitFor(() => expect(mockApi.overviews.setClosed).toHaveBeenCalledWith('o1', false))
    expect(screen.getByRole('button', { name: 'Unfreeze' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show to readers' })).toBeInTheDocument()
  })

  it('says the step is off, and answers an unknown overview with not found', async () => {
    mockApi.overviews.get.mockResolvedValue(detail({ on: false }))
    const { unmount } = renderPage()
    expect(await screen.findByText(/The Link Overviews step is off/)).toBeInTheDocument()
    unmount()

    mockApi.overviews.get.mockRejectedValue(new ApiError(404, 'Overview not found'))
    renderPage()
    expect(await screen.findByText('Overview not found')).toBeInTheDocument()
  })

  it('marks each cited fact by how it stands now, in every version, and says what is not there yet', async () => {
    const fact = (id: string, over: object) => ({
      id,
      gone: false as const,
      storyId: 's1',
      statement: `Fact ${id}.`,
      supportingSentence: `Fact ${id}.`,
      verdict: 'supported' as const,
      status: 'reviewed' as const,
      slot: null,
      outlet: 'Example',
      url: 'https://example.org/a',
      usable: true,
      ...over,
    })
    const version = detail().stands[0]!
    mockApi.overviews.get.mockResolvedValue(
      detail({
        stands: [
          { ...version, id: 'v2', number: 2, drops: [], sentences: [{ text: 'Cases rose.', facts: [fact('a', {})] }] },
          {
            ...version,
            status: 'superseded',
            sentences: [],
            doing: [
              {
                text: 'Vaccination began.',
                facts: [fact('b', { verdict: 'rejected', usable: false }), fact('c', { verdict: 'unjudged', status: 'unreviewed', usable: false })],
              },
            ],
          },
        ],
        members: [],
        decisions: [],
        decisionsTotal: 0,
        statusHistory: [],
      }),
    )
    renderPage()
    expect(await screen.findByText(/^Version 2 \(current\): as of Nov 2/)).toBeInTheDocument()
    expect(screen.getByText('Supported')).toBeInTheDocument()
    expect(screen.getByText('What is being done')).toBeInTheDocument()
    expect(screen.getByText('Rejected')).toBeInTheDocument()
    expect(screen.getByText('Not judged')).toBeInTheDocument()
    expect(screen.getByText('No entries.')).toBeInTheDocument()
    expect(screen.getByText('No decisions yet.')).toBeInTheDocument()
    expect(screen.getByText('No status changes yet.')).toBeInTheDocument()
  })
})

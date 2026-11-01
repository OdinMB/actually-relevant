import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { FeedChangesetReport, Issue } from '@shared/types'
import { ToastProvider } from '../ui/Toast'
import { ApiError } from '../../lib/admin-api'
import { FeedChangesetControls } from './FeedChangesetControls'

const mockFeedsApi = vi.hoisted(() => ({ previewChangeset: vi.fn(), applyChangeset: vi.fn() }))
vi.mock('../../lib/admin-api', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/admin-api')>()),
  adminApi: { feeds: mockFeedsApi },
}))

const issues = [
  { id: 'i-planet', name: 'Planet & Climate', slug: 'planet-climate', parentId: null },
  { id: 'i-pandemics', name: 'Pandemics', slug: 'pandemics', parentId: 'i-health' },
  { id: 'i-health', name: 'Health', slug: 'health', parentId: null },
] as unknown as Issue[]

const changesetFile = { format: 'actually-relevant/feed-changeset', version: 1, changes: [{ action: 'delete', match: { title: 'X' }, reason: 'r' }] }

function report(statuses: FeedChangesetReport['results'][number]['status'][]): FeedChangesetReport {
  const results = statuses.map((status, index) => ({
    index,
    action: 'update' as const,
    feedTitle: `Feed ${index}`,
    reason: 'Researched',
    status,
    message: status === 'error' ? 'Unknown issue "climat"' : 'Changes 1 field',
    diff: status === 'ok' ? [{ field: 'rssUrl', from: 'https://old.example/feed', to: 'https://new.example/feed' }] : undefined,
  }))
  const count = (s: string) => statuses.filter(x => x === s).length
  return { title: 'Fixes', results, counts: { ok: count('ok'), noop: count('noop'), error: count('error') } }
}

function renderControls() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <FeedChangesetControls issues={issues} />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

async function chooseFile(contents: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Import changes' }))
  const input = await screen.findByLabelText('Changeset file (.json)')
  fireEvent.change(input, { target: { files: [new File([contents], 'changes.json', { type: 'application/json' })] } })
}

describe('FeedChangesetControls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens the agent instructions from the info icon, listing the live issue slugs under their parents', async () => {
    renderControls()

    fireEvent.click(screen.getByRole('button', { name: 'How to prepare a changeset' }))

    const instructions = await screen.findByRole('region', { name: 'Agent instructions' })
    expect(instructions.textContent).toContain('- health: Health\n  - pandemics: Pandemics\n- planet-climate: Planet & Climate')
  })

  it('previews a chosen file and allows applying only when no change has an error', async () => {
    mockFeedsApi.previewChangeset.mockResolvedValue(report(['ok', 'error', 'noop']))
    renderControls()

    await chooseFile(JSON.stringify(changesetFile))

    expect(await screen.findByText('Unknown issue "climat"')).toBeInTheDocument()
    expect(mockFeedsApi.previewChangeset).toHaveBeenCalledWith(changesetFile)
    expect(screen.getByRole('button', { name: 'Apply 1 change' })).toBeDisabled()
  })

  it('applies a clean changeset and closes the panel', async () => {
    mockFeedsApi.previewChangeset.mockResolvedValue(report(['ok', 'ok', 'noop']))
    mockFeedsApi.applyChangeset.mockResolvedValue({ ...report(['ok', 'ok', 'noop']), applied: true })
    renderControls()

    await chooseFile(JSON.stringify(changesetFile))
    const apply = await screen.findByRole('button', { name: 'Apply 2 changes' })
    expect(apply).toBeEnabled()
    fireEvent.click(apply)

    await waitFor(() => expect(mockFeedsApi.applyChangeset).toHaveBeenCalledWith(changesetFile))
    expect(await screen.findByText('Applied 2 changes')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByLabelText('Changeset file (.json)')).not.toBeInTheDocument())
  })

  it('shows the refreshed preview when apply is refused, and keeps the panel open', async () => {
    mockFeedsApi.previewChangeset.mockResolvedValue(report(['ok']))
    mockFeedsApi.applyChangeset.mockRejectedValue(
      new ApiError(400, '1 of 1 changes has an error; nothing was applied', { ...report(['error']), applied: false }),
    )
    renderControls()

    await chooseFile(JSON.stringify(changesetFile))
    fireEvent.click(await screen.findByRole('button', { name: 'Apply 1 change' }))

    expect(await screen.findByText('Unknown issue "climat"')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply 0 changes' })).toBeDisabled()
  })

  it('reports a file that is not JSON without asking the server', async () => {
    renderControls()

    await chooseFile('{ not json')

    expect(await screen.findByRole('alert')).toHaveTextContent('not valid JSON')
    expect(mockFeedsApi.previewChangeset).not.toHaveBeenCalled()
  })

  it('names what is wrong when the server says the file is not a changeset', async () => {
    mockFeedsApi.previewChangeset.mockRejectedValue(
      new ApiError(400, 'Validation failed', { error: 'Validation failed', details: { formErrors: [], fieldErrors: { format: ['Invalid literal value'] } } }),
    )
    renderControls()

    await chooseFile(JSON.stringify({ ...changesetFile, format: 'opml' }))

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(/format: Invalid literal value/)).toBeInTheDocument()
  })
})

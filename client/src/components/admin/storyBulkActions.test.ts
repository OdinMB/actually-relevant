import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ResearchUsage } from '@shared/types'
import { adminApi } from '../../lib/admin-api'
import { storyBulkActions, type ConfirmAction, type StoryBulkActionDeps } from './storyBulkActions'

vi.mock('../../lib/admin-api', () => ({
  adminApi: {
    stories: { bulkPreassess: vi.fn(), bulkReclassify: vi.fn(), bulkAssess: vi.fn(), bulkSelect: vi.fn() },
    bluesky: { generateDraft: vi.fn(async () => ({ id: 'draft-1' })), pickAndDraft: vi.fn(async () => ({ id: 'draft-1' })) },
    mastodon: { generateDraft: vi.fn(async () => ({ id: 'draft-1' })), pickAndDraft: vi.fn(async () => ({ id: 'draft-1' })) },
  },
}))

const IDS = ['s1', 's2']

const usage: ResearchUsage = { enabled: true, refusal: null, applyRefusal: null, monthToDateUsd: 1, monthlyCapUsd: 30, reservationUsd: 0.25 }

const panel = () => ({ open: vi.fn(), show: vi.fn(), close: vi.fn() })

function fakeDeps(over: Partial<Pick<StoryBulkActionDeps, 'researchUsage'>> = {}) {
  return {
    confirm: vi.fn<(confirmation: ConfirmAction) => void>(),
    clearSelection: vi.fn<() => void>(),
    toast: vi.fn<StoryBulkActionDeps['toast']>(),
    launchPolledTask: vi.fn<StoryBulkActionDeps['launchPolledTask']>(),
    onTaskComplete: vi.fn<() => void>(),
    researchUsage: usage as StoryBulkActionDeps['researchUsage'],
    startResearch: vi.fn<StoryBulkActionDeps['startResearch']>(),
    applyResearch: vi.fn<StoryBulkActionDeps['applyResearch']>(),
    titleOf: (id: string) => `Title of ${id}`,
    drafts: { bluesky: panel(), mastodon: panel() },
    openClusterDialog: vi.fn<() => void>(),
    setStatus: vi.fn<StoryBulkActionDeps['setStatus']>().mockResolvedValue(undefined),
    ...over,
  }
}

/** The confirmation the handler asked for, run as the dialog's Confirm does. */
async function confirmed(deps: ReturnType<typeof fakeDeps>) {
  expect(deps.confirm).toHaveBeenCalledOnce()
  await deps.confirm.mock.calls[0]![0].action()
}

beforeEach(() => vi.clearAllMocks())

describe('storyBulkActions', () => {
  it.each([
    ['preassess', adminApi.stories.bulkPreassess],
    ['reclassify', adminApi.stories.bulkReclassify],
    ['assess', adminApi.stories.bulkAssess],
    ['select', adminApi.stories.bulkSelect],
  ] as const)('%s asks first, then clears the selection and runs one polled task over the stories through its own endpoint', async (action, endpoint) => {
    const deps = fakeDeps()
    storyBulkActions(deps)[action](IDS)
    expect(deps.launchPolledTask).not.toHaveBeenCalled()

    await confirmed(deps)

    expect(deps.clearSelection).toHaveBeenCalled()
    expect(deps.launchPolledTask).toHaveBeenCalledWith(expect.objectContaining({ storyIds: IDS, onComplete: deps.onTaskComplete }))
    await deps.launchPolledTask.mock.calls[0]![0].submitFn()
    expect(endpoint).toHaveBeenCalledWith(IDS)
  })

  it('research asks with its count and cost bound, then starts the bulk Research of the stories by title', async () => {
    const deps = fakeDeps()
    storyBulkActions(deps).research(IDS)
    expect(deps.confirm.mock.calls[0]![0].description).toContain('$0.50')

    await confirmed(deps)

    expect(deps.clearSelection).toHaveBeenCalled()
    expect(deps.startResearch).toHaveBeenCalledWith([
      { id: 's1', title: 'Title of s1' },
      { id: 's2', title: 'Title of s2' },
    ])
  })

  it("apply-research asks with its count, then applies the stories' researched versions by title", async () => {
    const deps = fakeDeps()
    storyBulkActions(deps)['apply-research'](IDS)
    expect(deps.confirm.mock.calls[0]![0].title).toContain('2')
    expect(deps.applyResearch).not.toHaveBeenCalled()

    await confirmed(deps)

    expect(deps.clearSelection).toHaveBeenCalled()
    expect(deps.applyResearch).toHaveBeenCalledWith([
      { id: 's1', title: 'Title of s1' },
      { id: 's2', title: 'Title of s2' },
    ])
  })

  it('research does nothing while the research usage is unknown', () => {
    const deps = fakeDeps({ researchUsage: undefined })
    storyBulkActions(deps).research(IDS)
    expect(deps.confirm).not.toHaveBeenCalled()
  })

  it.each([
    ['bluesky-post', 'bluesky', adminApi.bluesky.generateDraft, ['s1']],
    ['bluesky-pick', 'bluesky', adminApi.bluesky.pickAndDraft, [IDS]],
    ['mastodon-post', 'mastodon', adminApi.mastodon.generateDraft, ['s1']],
    ['mastodon-pick', 'mastodon', adminApi.mastodon.pickAndDraft, [IDS]],
  ] as const)('%s opens its channel panel empty and shows the draft its endpoint makes', async (action, channel, endpoint, args) => {
    const deps = fakeDeps()

    storyBulkActions(deps)[action](IDS)

    expect(deps.drafts[channel].open).toHaveBeenCalled()
    expect(endpoint).toHaveBeenCalledWith(...args)
    await vi.waitFor(() => expect(deps.drafts[channel].show).toHaveBeenCalledWith({ id: 'draft-1' }))
    expect(deps.confirm).not.toHaveBeenCalled()
  })

  it('a social draft that fails closes its panel and says why', async () => {
    vi.mocked(adminApi.mastodon.pickAndDraft).mockRejectedValueOnce(new Error('Mastodon is not configured'))
    const deps = fakeDeps()

    storyBulkActions(deps)['mastodon-pick'](IDS)

    await vi.waitFor(() => expect(deps.drafts.mastodon.close).toHaveBeenCalled())
    expect(deps.toast).toHaveBeenCalledWith('error', 'Mastodon is not configured')
    expect(deps.drafts.mastodon.show).not.toHaveBeenCalled()
  })

  it('a status asks first, then sets it on the stories, says so and clears the selection', async () => {
    const deps = fakeDeps()
    storyBulkActions(deps).rejected(IDS)
    expect(deps.setStatus).not.toHaveBeenCalled()

    await confirmed(deps)

    expect(deps.setStatus).toHaveBeenCalledWith(IDS, 'rejected')
    expect(deps.toast).toHaveBeenCalledWith('success', expect.any(String))
    expect(deps.clearSelection).toHaveBeenCalled()
  })

  it('create-cluster opens the cluster dialog', () => {
    const deps = fakeDeps()
    storyBulkActions(deps)['create-cluster'](IDS)
    expect(deps.openClusterDialog).toHaveBeenCalled()
    expect(deps.confirm).not.toHaveBeenCalled()
  })
})

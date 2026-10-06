import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NewVersionBanner } from './NewVersionBanner'
import { RUNNING_BUILD_ID } from '../../lib/buildVersion'

function renderBanner(deployedBuildId: string) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ buildId: deployedBuildId })))
  vi.stubGlobal('fetch', fetchMock)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><NewVersionBanner /></QueryClientProvider>)
  return client
}

afterEach(() => vi.unstubAllGlobals())

describe('NewVersionBanner', () => {
  it('offers a reload when a different build is deployed', async () => {
    renderBanner(`${RUNNING_BUILD_ID}-next`)
    expect(await screen.findByRole('button', { name: 'Reload' })).toBeTruthy()
  })

  it('stays hidden while the running build is the deployed one', async () => {
    const client = renderBanner(RUNNING_BUILD_ID)
    await waitFor(() => expect(client.getQueryState(['deployed-build-id'])?.status).toBe('success'))
    expect(screen.queryByRole('status')).toBeNull()
  })
})

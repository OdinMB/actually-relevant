import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchDeployedBuildId, isOutdated } from './buildVersion'

function respond(body: string, ok = true) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: ok ? 200 : 404 })))
}

afterEach(() => vi.unstubAllGlobals())

describe('fetchDeployedBuildId', () => {
  it('reads the deployed build id, bypassing the browser cache', async () => {
    respond(JSON.stringify({ buildId: 'abc123' }))
    expect(await fetchDeployedBuildId()).toBe('abc123')
    expect(fetch).toHaveBeenCalledWith('/version.json', { cache: 'no-store' })
  })

  it('is null when there is no version file (the dev server answers with the app page)', async () => {
    respond('<!DOCTYPE html><html></html>')
    expect(await fetchDeployedBuildId()).toBeNull()
    respond('not found', false)
    expect(await fetchDeployedBuildId()).toBeNull()
    respond(JSON.stringify({ other: 1 }))
    expect(await fetchDeployedBuildId()).toBeNull()
  })

  it('is null when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
    expect(await fetchDeployedBuildId()).toBeNull()
  })
})

describe('isOutdated', () => {
  it('is outdated only when a different build is deployed', () => {
    expect(isOutdated('new', 'old')).toBe(true)
    expect(isOutdated('same', 'same')).toBe(false)
    expect(isOutdated(null, 'old')).toBe(false)
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { adminApi } from './admin-api'
import { setAccessToken } from './session'

const mockFetch = vi.fn()

beforeEach(() => {
  mockFetch.mockReset()
  mockFetch.mockImplementation(() => Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({}) }))
  vi.stubGlobal('fetch', mockFetch)
  setAccessToken('test-key')
})

const call = (i: number) => {
  const [url, init] = mockFetch.mock.calls[i]! as [string, RequestInit | undefined]
  return { url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined }
}

describe('adminApi story context and spending', () => {
  it("reads, hides and moves a story's context cards", async () => {
    await adminApi.storyContext.get('s1')
    await adminApi.storyContext.setHidden('s1', true)
    await adminApi.storyContext.updateBox('s1', 'b2', { place: 'P2' })
    expect(call(0)).toMatchObject({ method: 'GET' })
    expect(call(0).url).toContain('/api/admin/stories/s1/context')
    expect(call(1)).toMatchObject({ method: 'PUT', body: { hidden: true } })
    expect(call(2)).toMatchObject({ method: 'PATCH', body: { place: 'P2' } })
    expect(call(2).url).toContain('/api/admin/stories/s1/context/boxes/b2')
  })

  it('reads the spending overview and sets a warning level', async () => {
    await adminApi.spending.overview()
    await adminApi.spending.setLevel('all', 40)
    expect(call(0).url).toContain('/api/admin/spending')
    expect(call(1)).toMatchObject({ method: 'PUT', body: { levelUsd: 40 } })
    expect(call(1).url).toContain('/api/admin/spending/warnings/all')
  })
})

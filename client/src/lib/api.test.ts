import { describe, it, expect, vi, afterEach } from 'vitest'
import { ApiError, isNotFound, isRateLimited, publicApi } from './api'

describe('isNotFound', () => {
  it('is true only for a 404 answer from the API', () => {
    expect(isNotFound(new ApiError(404, 'Story not found'))).toBe(true)
    expect(isNotFound(new ApiError(500, 'Failed to fetch story'))).toBe(false)
    expect(isNotFound(new ApiError(503, 'Service Unavailable'))).toBe(false)
    expect(isNotFound(new TypeError('Failed to fetch'))).toBe(false)
    expect(isNotFound(null)).toBe(false)
  })
})

describe('isRateLimited', () => {
  it('is true only for a 429 answer from the API', () => {
    expect(isRateLimited(new ApiError(429, 'Too many search requests. Please try again later.'))).toBe(true)
    expect(isRateLimited(new ApiError(503, 'Service Unavailable'))).toBe(false)
    expect(isRateLimited(new TypeError('Failed to fetch'))).toBe(false)
    expect(isRateLimited(null)).toBe(false)
  })
})

describe('publicApi requests', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('throws an ApiError with the status and the error text of a failed answer', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: 'Story not found' }), { status: 404 })))
    const error = await publicApi.stories.get('gone').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 404, message: 'Story not found' })
    expect(isNotFound(error)).toBe(true)
  })
})

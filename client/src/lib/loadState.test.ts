import { describe, it, expect } from 'vitest'
import { ApiError } from './api'
import { loadStateOf } from './loadState'

/** A query that has not started: no data, no error, not fetching. */
const idle = { data: undefined, error: null, isLoading: false, isPaused: false, isPlaceholderData: false, errorUpdateCount: 0 }

describe('loadStateOf', () => {
  it('is loading while the first answer is on its way', () => {
    expect(loadStateOf({ ...idle, isLoading: true }, false)).toBe('loading')
  })

  it('stays failed while a retry after a failure runs, which TanStack Query reports as loading', () => {
    expect(loadStateOf({ ...idle, isLoading: true, errorUpdateCount: 1 }, false)).toBe('failed')
  })

  it("stays failed while a retry runs under another page's placeholder data", () => {
    expect(loadStateOf({ ...idle, data: ['page 1'], isPlaceholderData: true, errorUpdateCount: 1 }, false)).toBe('failed')
  })

  it("is ready with another page's placeholder data while a page that never failed loads", () => {
    expect(loadStateOf({ ...idle, data: ['page 1'], isPlaceholderData: true }, false)).toBe('ready')
  })

  it('is ready once the data is there, and stays ready when a later refetch fails', () => {
    expect(loadStateOf({ ...idle, data: { id: 'story-1' } }, false)).toBe('ready')
    expect(loadStateOf({ ...idle, data: { id: 'story-1' }, error: new ApiError(500, 'Failed') }, false)).toBe('ready')
  })

  it('is not-found when the API answered 404', () => {
    expect(loadStateOf({ ...idle, error: new ApiError(404, 'Story not found') }, false)).toBe('not-found')
  })

  it.each([
    ['a server error', new ApiError(500, 'Failed to fetch story')],
    ['a busy server', new ApiError(503, 'Service Unavailable')],
    ['a dropped connection', new TypeError('Failed to fetch')],
    ['an answer that is not JSON', new SyntaxError('Unexpected token <')],
  ])('is failed for %s', (_, error) => {
    expect(loadStateOf({ ...idle, error }, false)).toBe('failed')
  })

  it('is failed while the browser is offline and the query waits to be back online', () => {
    expect(loadStateOf({ ...idle, isPaused: true }, false)).toBe('failed')
  })

  it('is not-found when there was nothing to ask for, as for a page without its slug', () => {
    expect(loadStateOf(idle, false)).toBe('not-found')
  })

  it('in the prerenderer, is loading for anything but data, so no failure is baked into static HTML', () => {
    expect(loadStateOf({ ...idle, error: new TypeError('Failed to fetch') }, true)).toBe('loading')
    expect(loadStateOf({ ...idle, error: new ApiError(404, 'Not found') }, true)).toBe('loading')
    expect(loadStateOf({ ...idle, isPaused: true }, true)).toBe('loading')
    expect(loadStateOf(idle, true)).toBe('loading')
    expect(loadStateOf({ ...idle, data: [] }, true)).toBe('ready')
  })

  it('checks for the prerenderer itself when not told', () => {
    // jsdom is not an automated browser
    expect(loadStateOf({ ...idle, error: new TypeError('Failed to fetch') })).toBe('failed')
  })
})

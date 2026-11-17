import { describe, it, expect, vi } from 'vitest'

vi.mock('../lib/prisma.js', () => ({ default: {} }))

const { transientFailure } = await import('./storyContextRuns.js')
const { TavilyError } = await import('../lib/tavily.js')

/** An error as the OpenAI SDK throws it: its class names it. */
const sdkError = (name: string, message: string, status?: number) => {
  const Named = { [name]: class extends Error {} }[name]!
  return Object.assign(new Named(message), status === undefined ? {} : { status })
}

describe('transientFailure', () => {
  it.each([
    ['a rate limit', sdkError('RateLimitError', '429 Rate limit reached', 429)],
    ['a server error', sdkError('InternalServerError', '500 The server had an error', 500)],
    ['a lost connection', sdkError('APIConnectionError', 'Connection error.')],
    ['a timeout, as LangChain rethrows it', Object.assign(new Error('Request timed out.'), { name: 'TimeoutError' })],
    ["Tavily's server error after its retries", new TavilyError('Tavily search failed: HTTP 502', 502)],
    ["Tavily's timeout", new TavilyError('Tavily search failed: ECONNABORTED', undefined, 'ECONNABORTED')],
  ])('holds for %s', (_what, err) => {
    expect(transientFailure(err)).toBe(true)
  })

  it.each([
    ['a refused request', sdkError('BadRequestError', '400 Invalid schema', 400)],
    ['a missing key', sdkError('AuthenticationError', '401 Incorrect API key', 401)],
    ["Tavily's refusal", new TavilyError('Tavily search failed: HTTP 401', 401)],
    ['an unexpected shape', new TavilyError('Tavily search returned a response of an unexpected shape')],
    ['an error of ours', new TypeError("Cannot read properties of undefined (reading 'id')")],
    ['something not an error', 'boom'],
  ])('does not hold for %s', (_what, err) => {
    expect(transientFailure(err)).toBe(false)
  })
})

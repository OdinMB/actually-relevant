import { describe, it, expect, vi } from 'vitest'
import { APIError } from 'openai'
import { withRetry, isRetryableError, isConnectionNotEstablished, provedNotSent } from './retry.js'

describe('provedNotSent', () => {
  it('is true when no connection was made, or the server refused the request (4xx)', () => {
    expect(provedNotSent({ code: 'ECONNREFUSED' })).toBe(true)
    expect(provedNotSent({ response: { status: 400 } })).toBe(true)
    expect(provedNotSent({ response: { status: 403 } })).toBe(true)
    expect(provedNotSent({ response: { status: 429 } })).toBe(true)
  })

  it('is false when the server may have accepted the request', () => {
    expect(provedNotSent({ code: 'ECONNABORTED' })).toBe(false)
    expect(provedNotSent({ code: 'ECONNRESET' })).toBe(false)
    expect(provedNotSent({ response: { status: 500 } })).toBe(false)
    expect(provedNotSent({ response: { status: 503 } })).toBe(false)
    expect(provedNotSent(new Error('timeout of 15000ms exceeded'))).toBe(false)
    expect(provedNotSent(null)).toBe(false)
  })
})

describe('isConnectionNotEstablished', () => {
  it('is true when the connection was refused or the host did not resolve', () => {
    expect(isConnectionNotEstablished({ code: 'ECONNREFUSED' })).toBe(true)
    expect(isConnectionNotEstablished({ code: 'ENOTFOUND' })).toBe(true)
    expect(isConnectionNotEstablished({ code: 'EAI_AGAIN' })).toBe(true)
  })

  it('is false when the request may have reached the server', () => {
    expect(isConnectionNotEstablished({ code: 'ECONNABORTED' })).toBe(false)
    expect(isConnectionNotEstablished({ code: 'ETIMEDOUT' })).toBe(false)
    expect(isConnectionNotEstablished({ code: 'ECONNRESET' })).toBe(false)
    expect(isConnectionNotEstablished(new Error('timeout of 15000ms exceeded'))).toBe(false)
    expect(isConnectionNotEstablished({ response: { status: 429 } })).toBe(false)
    expect(isConnectionNotEstablished({ response: { status: 503 } })).toBe(false)
  })

  it('is false when a response came back, whatever the code', () => {
    expect(isConnectionNotEstablished({ code: 'ECONNREFUSED', response: { status: 502 } })).toBe(false)
  })

  it('is false for non-objects', () => {
    expect(isConnectionNotEstablished(null)).toBe(false)
    expect(isConnectionNotEstablished('ECONNREFUSED')).toBe(false)
  })
})

describe('isRetryableError', () => {
  it('retries on timeout errors', () => {
    expect(isRetryableError(new Error('Request timeout'))).toBe(true)
    expect(isRetryableError(new Error('ECONNRESET'))).toBe(true)
    expect(isRetryableError(new Error('ECONNREFUSED'))).toBe(true)
    expect(isRetryableError(new Error('socket hang up'))).toBe(true)
  })

  it('retries on 429 status', () => {
    expect(isRetryableError({ response: { status: 429 } })).toBe(true)
  })

  it('retries on 5xx status codes', () => {
    expect(isRetryableError({ response: { status: 500 } })).toBe(true)
    expect(isRetryableError({ response: { status: 502 } })).toBe(true)
    expect(isRetryableError({ response: { status: 503 } })).toBe(true)
  })

  it('retries on network error codes', () => {
    expect(isRetryableError({ code: 'ECONNABORTED' })).toBe(true)
    expect(isRetryableError({ code: 'ETIMEDOUT' })).toBe(true)
  })

  it('does not retry on 4xx client errors', () => {
    expect(isRetryableError({ response: { status: 400 } })).toBe(false)
    expect(isRetryableError({ response: { status: 404 } })).toBe(false)
    expect(isRetryableError({ response: { status: 422 } })).toBe(false)
  })

  it('does not retry on generic errors', () => {
    expect(isRetryableError(new Error('some bug'))).toBe(false)
    expect(isRetryableError('string error')).toBe(false)
  })

  // The OpenAI SDK puts the status on err.status, not err.response.status
  it('retries OpenAI SDK 429 and 5xx errors', () => {
    expect(isRetryableError(APIError.generate(429, {}, 'Rate limit reached', new Headers()))).toBe(true)
    expect(isRetryableError(APIError.generate(500, {}, 'server error', new Headers()))).toBe(true)
    expect(isRetryableError(APIError.generate(503, {}, 'overloaded', new Headers()))).toBe(true)
  })

  it('does not retry OpenAI SDK 4xx errors', () => {
    expect(isRetryableError(APIError.generate(400, {}, 'bad request', new Headers()))).toBe(false)
    expect(isRetryableError(APIError.generate(401, {}, 'bad key', new Headers()))).toBe(false)
  })
})

// Helper: create an axios-like error with response status
function axiosError(status: number): Error & { response: { status: number } } {
  const err = new Error(`Request failed with status ${status}`) as Error & { response: { status: number } }
  err.response = { status }
  return err
}

describe('withRetry', () => {
  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('success')

    const result = await withRetry(fn)

    expect(result).toBe('success')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries on retryable error and succeeds', async () => {
    const fn = vi.fn().mockRejectedValueOnce(axiosError(503)).mockResolvedValue('recovered')

    const result = await withRetry(fn, { baseDelayMs: 1 })

    expect(result).toBe('recovered')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('throws after all retries exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(axiosError(503))

    await expect(withRetry(fn, { retries: 2, baseDelayMs: 1 })).rejects.toThrow('Request failed with status 503')
    expect(fn).toHaveBeenCalledTimes(3) // initial + 2 retries
  })

  it('does not retry non-retryable errors', async () => {
    const fn = vi.fn().mockRejectedValue(axiosError(400))

    await expect(withRetry(fn, { baseDelayMs: 1 })).rejects.toThrow('Request failed with status 400')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('respects custom retryOn predicate', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('custom retryable')).mockResolvedValue('ok')

    const result = await withRetry(fn, {
      baseDelayMs: 1,
      retryOn: err => err instanceof Error && err.message.includes('custom retryable'),
    })

    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('defaults to 3 retries', async () => {
    const fn = vi.fn().mockRejectedValue(axiosError(500))

    await expect(withRetry(fn, { baseDelayMs: 1 })).rejects.toThrow('Request failed with status 500')
    expect(fn).toHaveBeenCalledTimes(4) // initial + 3 retries
  })
})

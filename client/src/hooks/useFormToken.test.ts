import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFormToken } from './useFormToken'
import { FORM_TOKEN_MIN_AGE_MS, FORM_TOKEN_POST_MAX_AGE_MS, FORM_TOKEN_REFRESH_MS } from '../lib/formToken'

const MINUTE = 60 * 1000

let visibility: DocumentVisibilityState

beforeEach(() => {
  vi.useFakeTimers()
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
})

afterEach(() => {
  vi.useRealTimers()
  Reflect.deleteProperty(document, 'visibilityState')
})

/** A token source that answers each request with the next of `answers` (a string is a token, anything else is thrown). */
function source(...answers: unknown[]) {
  const fetchToken = vi.fn<() => Promise<string>>()
  for (const answer of answers) {
    fetchToken.mockImplementationOnce(async () => {
      if (typeof answer === 'string') return answer
      throw answer
    })
  }
  return fetchToken
}

/** Moves the (fake) clock on and lets the fetches it settles reach React. */
async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

/** Starts a call for the token to post and notes what it gives, without waiting for it. */
function startPostableToken(getPostableToken: () => Promise<string>) {
  const call: { value?: string; error?: unknown } = {}
  getPostableToken().then(
    value => (call.value = value),
    error => (call.error = error),
  )
  return call
}

function comeBack(event: 'visibilitychange' | 'focus' = 'visibilitychange') {
  act(() => {
    if (event === 'focus') window.dispatchEvent(new Event('focus'))
    else document.dispatchEvent(new Event('visibilitychange'))
  })
}

describe('useFormToken', () => {
  describe('the first token', () => {
    it('is loading until the first token arrives, then ready', async () => {
      const { result } = renderHook(() => useFormToken(source('first')))
      expect(result.current.status).toBe('loading')

      await wait(0)
      expect(result.current.status).toBe('ready')
    })

    it('asks a second time when the first request fails', async () => {
      const fetchToken = source(new Error('blip'), 'second')
      const { result } = renderHook(() => useFormToken(fetchToken))

      await wait(0)
      expect(result.current.status).toBe('ready')
      expect(fetchToken).toHaveBeenCalledTimes(2)
      await expect(result.current.getPostableToken()).resolves.toBe('second')
    })

    it('fails with the last error when both requests fail', async () => {
      const last = new Error('still down')
      const { result } = renderHook(() => useFormToken(source(new Error('down'), last)))

      await wait(0)
      expect(result.current).toMatchObject({ status: 'failed', error: last })
    })

    it('asks only once when the answer is final', async () => {
      const final = new Error('paused')
      const fetchToken = source(final, 'never asked for')
      const { result } = renderHook(() => useFormToken(fetchToken, { isFinal: err => err === final }))

      await wait(0)
      expect(result.current).toMatchObject({ status: 'failed', error: final })
      expect(fetchToken).toHaveBeenCalledTimes(1)
    })

    // Its age is how long the form has been open, which is what the server's minimum measures.
    it('is given at once, however soon after it arrives', async () => {
      const { result } = renderHook(() => useFormToken(source('first')))
      await wait(0)

      const call = startPostableToken(result.current.getPostableToken)
      await wait(0)

      expect(call.value).toBe('first')
    })

    it('is given, asking for none, while it is 25 minutes old', async () => {
      const fetchToken = source('first')
      const { result } = renderHook(() => useFormToken(fetchToken))
      await wait(0)

      await wait(FORM_TOKEN_POST_MAX_AGE_MS)
      const call = startPostableToken(result.current.getPostableToken)
      await wait(0)

      expect(call.value).toBe('first')
      expect(fetchToken).toHaveBeenCalledTimes(1)
    })

    it('keeps the token source of the first render', async () => {
      const first = source('first', 'replacement')
      const later = source('from a later render')
      const { result, rerender } = renderHook(({ fetchToken }) => useFormToken(fetchToken), { initialProps: { fetchToken: first } })
      await wait(0)

      rerender({ fetchToken: later })
      await wait(FORM_TOKEN_POST_MAX_AGE_MS + 1)
      const call = startPostableToken(result.current.getPostableToken)
      await wait(FORM_TOKEN_MIN_AGE_MS)

      expect(call.value).toBe('replacement')
      expect(later).not.toHaveBeenCalled()
    })
  })

  describe('a token too old to post', () => {
    it('is replaced first, and the replacement given only once it is old enough for the server', async () => {
      const fetchToken = source('first', 'replacement')
      const { result } = renderHook(() => useFormToken(fetchToken))
      await wait(0)

      await wait(FORM_TOKEN_POST_MAX_AGE_MS + 1)
      const call = startPostableToken(result.current.getPostableToken)
      await wait(FORM_TOKEN_MIN_AGE_MS - 1)
      expect(fetchToken).toHaveBeenCalledTimes(2)
      expect(call.value).toBeUndefined()

      await wait(1)
      expect(call.value).toBe('replacement')
    })

    it('is replaced asking twice, and the call fails with the last error when both requests fail', async () => {
      const last = new Error('still down')
      const fetchToken = source('first', new Error('down'), last)
      const { result } = renderHook(() => useFormToken(fetchToken))
      await wait(0)

      await wait(FORM_TOKEN_POST_MAX_AGE_MS + 1)
      const call = startPostableToken(result.current.getPostableToken)
      await wait(0)

      expect(call.error).toBe(last)
      expect(fetchToken).toHaveBeenCalledTimes(3)
      expect(result.current.status).toBe('ready')
    })

    it('fails the call at once with a final answer', async () => {
      const final = new Error('paused')
      const fetchToken = source('first', final)
      const { result } = renderHook(() => useFormToken(fetchToken, { isFinal: err => err === final }))
      await wait(0)

      await wait(FORM_TOKEN_POST_MAX_AGE_MS + 1)
      const call = startPostableToken(result.current.getPostableToken)
      await wait(0)

      expect(call.error).toBe(final)
      expect(fetchToken).toHaveBeenCalledTimes(2)
    })
  })

  describe('when the reader comes back to the page', () => {
    it('replaces a token 20 minutes old when the tab turns visible', async () => {
      const fetchToken = source('first', 'replacement')
      renderHook(() => useFormToken(fetchToken))
      await wait(0)

      await wait(FORM_TOKEN_REFRESH_MS)
      comeBack()
      await wait(0)

      expect(fetchToken).toHaveBeenCalledTimes(2)
    })

    it('replaces it when the window gets focus too', async () => {
      const fetchToken = source('first', 'replacement')
      renderHook(() => useFormToken(fetchToken))
      await wait(0)

      await wait(FORM_TOKEN_REFRESH_MS)
      comeBack('focus')
      await wait(0)

      expect(fetchToken).toHaveBeenCalledTimes(2)
    })

    it('asks for none while the token is younger than 20 minutes', async () => {
      const fetchToken = source('first')
      renderHook(() => useFormToken(fetchToken))
      await wait(0)

      await wait(FORM_TOKEN_REFRESH_MS - 1)
      comeBack()
      comeBack('focus')
      await wait(0)

      expect(fetchToken).toHaveBeenCalledTimes(1)
    })

    it('asks for none while the tab is hidden, however old the token', async () => {
      const fetchToken = source('first')
      renderHook(() => useFormToken(fetchToken))
      await wait(0)

      await wait(31 * MINUTE)
      visibility = 'hidden'
      comeBack()
      await wait(0)

      expect(fetchToken).toHaveBeenCalledTimes(1)
    })

    it('asks for none before the first token has arrived', async () => {
      const fetchToken = vi.fn<() => Promise<string>>(() => new Promise(() => {}))
      renderHook(() => useFormToken(fetchToken))

      await wait(31 * MINUTE)
      comeBack()
      await wait(0)

      expect(fetchToken).toHaveBeenCalledTimes(1)
    })

    it('gives the replacement once it is old enough for the server', async () => {
      const { result } = renderHook(() => useFormToken(source('first', 'replacement')))
      await wait(0)

      await wait(31 * MINUTE)
      comeBack()
      await wait(0)
      const call = startPostableToken(result.current.getPostableToken)
      await wait(FORM_TOKEN_MIN_AGE_MS - 1)
      expect(call.value).toBeUndefined()

      await wait(1)
      expect(call.value).toBe('replacement')
    })

    it('keeps the token it holds when the replacement fails, still giving it while young enough', async () => {
      const fetchToken = source('first', new Error('down'), new Error('still down'))
      const { result } = renderHook(() => useFormToken(fetchToken))
      await wait(0)

      await wait(21 * MINUTE)
      comeBack()
      await wait(0)
      expect(fetchToken).toHaveBeenCalledTimes(3)
      expect(result.current.status).toBe('ready')

      const call = startPostableToken(result.current.getPostableToken)
      await wait(0)
      expect(call.value).toBe('first')
    })

    it('makes one request when the tab turning visible, the window getting focus and a call for the token come together', async () => {
      let deliver!: (token: string) => void
      const fetchToken = source('first')
      fetchToken.mockImplementationOnce(() => new Promise<string>(resolve => (deliver = resolve)))
      const { result } = renderHook(() => useFormToken(fetchToken))
      await wait(0)

      await wait(31 * MINUTE)
      comeBack()
      comeBack('focus')
      const call = startPostableToken(result.current.getPostableToken)
      await wait(0)
      expect(fetchToken).toHaveBeenCalledTimes(2)

      await act(async () => deliver('replacement'))
      await wait(FORM_TOKEN_MIN_AGE_MS)
      expect(call.value).toBe('replacement')
      expect(fetchToken).toHaveBeenCalledTimes(2)
    })

    it('stops listening once the form is gone', async () => {
      const fetchToken = source('first')
      const { unmount } = renderHook(() => useFormToken(fetchToken))
      await wait(0)

      unmount()
      await wait(31 * MINUTE)
      comeBack()
      comeBack('focus')
      await wait(0)

      expect(fetchToken).toHaveBeenCalledTimes(1)
    })
  })
})

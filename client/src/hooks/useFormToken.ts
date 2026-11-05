import { useCallback, useEffect, useRef, useState } from 'react'
import { FORM_TOKEN_MIN_AGE_MS, FORM_TOKEN_POST_MAX_AGE_MS, FORM_TOKEN_REFRESH_MS } from '../lib/formToken'

/** The anti-bot form token a form holds, with the times (`Date.now()`) that decide when it may be posted. */
interface HeldToken {
  value: string
  receivedAt: number
  /**
   * From when the server takes it. The first token may be posted at once: its age is how long
   * the form has been open, which is what the server's minimum fill time measures. A
   * replacement's age says nothing about the reader, so it waits out that minimum.
   */
  postableFrom: number
}

/** Where the form's first token stands. `failed` holds the error that ended its fetch. */
export type FormTokenStatus = { status: 'loading' } | { status: 'ready' } | { status: 'failed'; error: unknown }

export type FormToken = FormTokenStatus & {
  /**
   * The token to post: replaced first when it is too old for the server, and given once it is
   * old enough. Rejects with the fetch's error when a needed replacement cannot be fetched.
   */
  getPostableToken: () => Promise<string>
}

export interface FormTokenOptions {
  /** An answer that a second request would not change (e.g. signups paused): it is not retried. */
  isFinal?: (err: unknown) => boolean
}

/** Asks for a token, trying twice. A final answer is thrown at once; otherwise the last error is. */
async function fetchWithOneRetry(fetchToken: () => Promise<string>, isFinal: (err: unknown) => boolean): Promise<string> {
  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await fetchToken()
    } catch (err) {
      if (isFinal(err)) throw err
      lastError = err
    }
  }
  throw lastError
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Holds a form's anti-bot token so that the form only ever posts one the server takes
 * (lib/formToken.ts has the window). Fetches the first token on mount; replaces an ageing one
 * when the reader comes back to the page; and `getPostableToken` replaces one too old to post
 * and waits until a replacement is old enough. Every fetch asks twice, and a replacement joins
 * one already under way.
 *
 * `fetchToken` makes one request for a token. It and `isFinal` are read on the first render
 * only: a form takes its tokens from one route.
 */
export function useFormToken(fetchToken: () => Promise<string>, { isFinal = () => false }: FormTokenOptions = {}): FormToken {
  const source = useRef({ fetchToken, isFinal })
  const [status, setStatus] = useState<FormTokenStatus>({ status: 'loading' })
  // Never rendered, so a ref: `status` turns 'ready' when the first token arrives.
  const heldRef = useRef<HeldToken | null>(null)
  const replacementRef = useRef<Promise<HeldToken> | null>(null)

  const request = useCallback(() => fetchWithOneRetry(source.current.fetchToken, source.current.isFinal), [])

  useEffect(() => {
    let cancelled = false
    request().then(
      value => {
        if (cancelled) return
        const now = Date.now()
        heldRef.current = { value, receivedAt: now, postableFrom: now }
        setStatus({ status: 'ready' })
      },
      error => {
        if (!cancelled) setStatus({ status: 'failed', error })
      },
    )
    return () => {
      cancelled = true
    }
  }, [request])

  /** Fetches a token to replace the one held, joining a fetch already under way. */
  const replace = useCallback((): Promise<HeldToken> => {
    if (!replacementRef.current) {
      replacementRef.current = request()
        .then(value => {
          const receivedAt = Date.now()
          const held = { value, receivedAt, postableFrom: receivedAt + FORM_TOKEN_MIN_AGE_MS }
          heldRef.current = held
          return held
        })
        .finally(() => {
          replacementRef.current = null
        })
    }
    return replacementRef.current
  }, [request])

  // Timers stop in a background tab, so the moment a reader comes back to the page is when an
  // ageing token is replaced: the new one is then old enough by the time they submit.
  useEffect(() => {
    function replaceIfAgeing() {
      const held = heldRef.current
      if (document.visibilityState !== 'visible' || !held) return
      if (Date.now() - held.receivedAt < FORM_TOKEN_REFRESH_MS) return
      // On failure the held token stays, and getPostableToken tries again.
      replace().catch(() => {})
    }
    document.addEventListener('visibilitychange', replaceIfAgeing)
    window.addEventListener('focus', replaceIfAgeing)
    return () => {
      document.removeEventListener('visibilitychange', replaceIfAgeing)
      window.removeEventListener('focus', replaceIfAgeing)
    }
  }, [replace])

  const getPostableToken = useCallback(async (): Promise<string> => {
    let held = heldRef.current
    if (!held || Date.now() - held.receivedAt > FORM_TOKEN_POST_MAX_AGE_MS) held = await replace()
    const wait = held.postableFrom - Date.now()
    if (wait > 0) await sleep(wait)
    return held.value
  }, [replace])

  return { ...status, getPostableToken }
}

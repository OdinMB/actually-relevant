import { useCallback, useEffect, useRef } from 'react'
import { runTurnstileChallenge, type TurnstileChallenge } from '../lib/turnstile'

/**
 * A component's handle on on-demand Turnstile challenges: a container for the
 * (usually invisible) widget and `getToken`, which runs one challenge in it. A new
 * call cancels the one before, and unmounting cancels whatever is pending.
 */
export function useTurnstileChallenge() {
  const containerRef = useRef<HTMLDivElement>(null)
  const pending = useRef<TurnstileChallenge | null>(null)

  useEffect(() => () => pending.current?.cancel(), [])

  const getToken = useCallback((siteKey: string): Promise<string> => {
    pending.current?.cancel()
    const container = containerRef.current
    if (!container) return Promise.reject(new Error('Turnstile container is not mounted'))
    const challenge = runTurnstileChallenge(container, siteKey)
    pending.current = challenge
    return challenge.token
  }, [])

  return { containerRef, getToken }
}

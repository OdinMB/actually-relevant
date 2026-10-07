import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import type { UserRole } from '@shared/types'
import { authApi, ApiError } from './admin-api'
import { setAccessToken, onSessionExpired } from './session'

interface AuthUser {
  id: string
  email: string
  name: string
  role: UserRole
}

/**
 * - `unchecked`: no restore attempted yet on this page load (admin routes must wait, not redirect)
 * - `checking`: the restore is in flight
 * - `unavailable`: the server could not answer; the session may still be valid
 */
type SessionStatus = 'unchecked' | 'checking' | 'authenticated' | 'anonymous' | 'unavailable'

interface AuthContextValue {
  user: AuthUser | null
  isAuthenticated: boolean
  /** True until the session restore has finished: show a spinner, never a redirect. */
  isLoading: boolean
  /** The restore could not reach the server, so whether the person is signed in is unknown. */
  isServerUnavailable: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  /** Call this when entering admin routes to restore session if available (once per page load) */
  tryRestoreSession: () => Promise<void>
  /** Restore again after the server was unavailable */
  retryRestoreSession: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  // Public pages never restore, so they stay `unchecked` without cost
  const [status, setStatus] = useState<SessionStatus>('unchecked')
  const hasAttemptedRestore = useRef(false)

  // Clean up old localStorage-based auth (one-time)
  if (typeof window !== 'undefined') {
    localStorage.removeItem('admin_api_key')
  }

  const endSession = useCallback(() => {
    setAccessToken(null)
    setUser(null)
    setStatus('anonymous')
  }, [])

  // A refresh rejected mid-use ends the session; the admin guard then sends the person to login
  useEffect(() => onSessionExpired(endSession), [endSession])

  const restore = useCallback(async () => {
    hasAttemptedRestore.current = true
    setStatus('checking')

    const outcome = await authApi.refresh()
    if (outcome.status === 'unauthorized') {
      endSession()
      return
    }
    if (outcome.status === 'unavailable') {
      setStatus('unavailable')
      return
    }

    try {
      const userData = await authApi.me()
      setUser(userData as AuthUser)
      setStatus('authenticated')
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        endSession()
      } else {
        setStatus('unavailable')
      }
    }
  }, [endSession])

  const tryRestoreSession = useCallback(async () => {
    if (hasAttemptedRestore.current) return
    await restore()
  }, [restore])

  const login = useCallback(async (email: string, password: string) => {
    try {
      const result = await authApi.login(email, password)
      setAccessToken(result.accessToken)
      hasAttemptedRestore.current = true
      setUser(result.user as AuthUser)
      setStatus('authenticated')
    } catch (err) {
      setAccessToken(null)
      setUser(null)
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        throw new Error('Invalid email or password')
      }
      throw new Error('Could not connect to server')
    }
  }, [])

  const logout = useCallback(async () => {
    await authApi.logout()
    setUser(null)
    setStatus('anonymous')
  }, [])

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated: !!user,
      isLoading: status === 'unchecked' || status === 'checking',
      isServerUnavailable: status === 'unavailable',
      login,
      logout,
      tryRestoreSession,
      retryRestoreSession: restore,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

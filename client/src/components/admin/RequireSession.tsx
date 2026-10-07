import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { loginRedirectState } from '../../lib/authRedirect'
import { LoadingSpinner } from '../ui/LoadingSpinner'
import { Button } from '../ui/Button'

/**
 * Admin route guard. Restores the session on a fresh page load and waits for
 * it before deciding, so a reload keeps its URL; sends a signed-out person to
 * login remembering the URL; never mistakes an unreachable server for a logout.
 */
export function RequireSession({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading, isServerUnavailable, tryRestoreSession, retryRestoreSession } = useAuth()
  const location = useLocation()

  useEffect(() => {
    tryRestoreSession()
  }, [tryRestoreSession])

  if (isLoading) {
    return (
      <main className="flex items-center justify-center min-h-screen">
        <h1 className="sr-only">Loading</h1>
        <LoadingSpinner size="lg" />
      </main>
    )
  }

  if (isServerUnavailable) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
        <div className="w-full max-w-sm rounded-lg border border-neutral-200 bg-white p-6 text-center shadow-sm" role="alert">
          <h1 className="text-lg font-semibold text-neutral-900">Can't reach the server</h1>
          <p className="mt-2 text-sm text-neutral-600">
            You may still be signed in. Check your connection, or wait a moment if the site is being updated.
          </p>
          <Button className="mt-4 w-full" onClick={() => { retryRestoreSession() }}>
            Try again
          </Button>
        </div>
      </main>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/admin/login" replace state={loginRedirectState(location)} />
  }

  return <>{children}</>
}

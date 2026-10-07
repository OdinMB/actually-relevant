import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HelmetProvider } from 'react-helmet-async'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { AuthProvider } from '../../lib/auth'
import { notifySessionExpired } from '../../lib/session'
import type { RefreshOutcome } from '../../lib/session'
import { RequireSession } from './RequireSession'
import LoginPage from '../../pages/admin/LoginPage'

const mockAuthApi = vi.hoisted(() => ({
  refresh: vi.fn<() => Promise<RefreshOutcome>>(),
  me: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
}))

vi.mock('../../lib/admin-api', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/admin-api')>()),
  authApi: mockAuthApi,
}))

vi.mock('../../App', () => ({ preloadAdminChunks: vi.fn() }))

const admin = { id: 'u1', email: 'a@b.test', name: 'Admin', role: 'admin' }
const DEEP_URL = '/admin/podcasts/abc?tab=script'

const loginRendered = vi.fn()

function LocationProbe({ label }: { label: string }) {
  const location = useLocation()
  if (label === 'login') loginRendered()
  return <p data-testid="location">{`${label} ${location.pathname}${location.search}`}</p>
}

function renderAdmin(initialUrl: string) {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[initialUrl]}>
        <AuthProvider>
          <Routes>
            <Route path="/admin/login" element={<><LocationProbe label="login" /><LoginPage /></>} />
            <Route path="/admin/*" element={<RequireSession><LocationProbe label="page" /></RequireSession>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </HelmetProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('RequireSession', () => {
  it('keeps a reloaded deep URL when the session is valid, without passing through login', async () => {
    mockAuthApi.refresh.mockResolvedValue({ status: 'ok', accessToken: 't' })
    mockAuthApi.me.mockResolvedValue(admin)

    renderAdmin(DEEP_URL)

    expect(await screen.findByText(`page ${DEEP_URL}`)).toBeInTheDocument()
    expect(loginRendered).not.toHaveBeenCalled()
  })

  it('sends an expired session to login and back to the same URL after signing in', async () => {
    mockAuthApi.refresh.mockResolvedValue({ status: 'unauthorized' })
    mockAuthApi.login.mockResolvedValue({ accessToken: 't', user: admin })

    renderAdmin(DEEP_URL)

    expect(await screen.findByText('login /admin/login')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.test')
    await userEvent.type(screen.getByLabelText('Password'), 'pw-for-test')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText(`page ${DEEP_URL}`)).toBeInTheDocument()
  })

  it('stays on the URL and offers a retry when the server cannot be reached', async () => {
    mockAuthApi.refresh.mockResolvedValueOnce({ status: 'unavailable' })
    mockAuthApi.refresh.mockResolvedValueOnce({ status: 'ok', accessToken: 't' })
    mockAuthApi.me.mockResolvedValue(admin)

    renderAdmin(DEEP_URL)

    await userEvent.click(await screen.findByRole('button', { name: /try again/i }))

    expect(await screen.findByText(`page ${DEEP_URL}`)).toBeInTheDocument()
    expect(loginRendered).not.toHaveBeenCalled()
  })

  it('sends a session that ends mid-use to login, remembering the page', async () => {
    mockAuthApi.refresh.mockResolvedValue({ status: 'ok', accessToken: 't' })
    mockAuthApi.me.mockResolvedValue(admin)
    renderAdmin(DEEP_URL)
    await screen.findByText(`page ${DEEP_URL}`)

    act(() => notifySessionExpired())

    expect(await screen.findByText('login /admin/login')).toBeInTheDocument()
    mockAuthApi.login.mockResolvedValue({ accessToken: 't', user: admin })
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.test')
    await userEvent.type(screen.getByLabelText('Password'), 'pw-for-test')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText(`page ${DEEP_URL}`)).toBeInTheDocument()
  })
})

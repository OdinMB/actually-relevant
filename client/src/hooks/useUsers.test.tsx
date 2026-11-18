import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { adminApi } from '../lib/admin-api'
import { useCreateUser, useDeleteUser, useResetPassword, useUpdateUser, useUser, useUsers } from './useUsers'

vi.mock('../lib/admin-api', () => ({
  adminApi: {
    users: {
      list: vi.fn().mockResolvedValue([{ id: 'u1' }]),
      get: vi.fn().mockResolvedValue({ id: 'u1' }),
      create: vi.fn().mockResolvedValue({ id: 'u2' }),
      update: vi.fn().mockResolvedValue({ id: 'u1' }),
      delete: vi.fn().mockResolvedValue(undefined),
      resetPassword: vi.fn().mockResolvedValue(undefined),
    },
  },
}))

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  return { wrapper, invalidated: () => invalidate.mock.calls.map(([filters]) => filters?.queryKey) }
}

describe('user hooks', () => {
  beforeEach(() => vi.clearAllMocks())

  it('loads the users, and one user only once an id is given', async () => {
    const { wrapper } = setup()
    const list = renderHook(() => useUsers(), { wrapper })
    await waitFor(() => expect(list.result.current.data).toEqual([{ id: 'u1' }]))

    const none = renderHook(() => useUser(''), { wrapper })
    expect(none.result.current.fetchStatus).toBe('idle')
    const one = renderHook(() => useUser('u1'), { wrapper })
    await waitFor(() => expect(one.result.current.data).toEqual({ id: 'u1' }))
    expect(adminApi.users.get).toHaveBeenCalledTimes(1)
  })

  it('reloads the users after a create, an update and a delete', async () => {
    const { wrapper, invalidated } = setup()
    const create = renderHook(() => useCreateUser(), { wrapper })
    const update = renderHook(() => useUpdateUser(), { wrapper })
    const remove = renderHook(() => useDeleteUser(), { wrapper })

    await act(() => create.result.current.mutateAsync({ email: 'a@example.org', name: 'A', password: 'secret-password' }))
    await act(() => update.result.current.mutateAsync({ id: 'u1', data: { name: 'B' } }))
    await act(() => remove.result.current.mutateAsync('u1'))

    expect(adminApi.users.update).toHaveBeenCalledWith('u1', { name: 'B' })
    expect(adminApi.users.delete).toHaveBeenCalledWith('u1')
    expect(invalidated()).toEqual([['users'], ['users'], ['users']])
  })

  it('resets a password without reloading the list', async () => {
    const { wrapper, invalidated } = setup()
    const reset = renderHook(() => useResetPassword(), { wrapper })
    await act(() => reset.result.current.mutateAsync({ id: 'u1', password: 'new-password' }))
    expect(adminApi.users.resetPassword).toHaveBeenCalledWith('u1', 'new-password')
    expect(invalidated()).toEqual([])
  })
})

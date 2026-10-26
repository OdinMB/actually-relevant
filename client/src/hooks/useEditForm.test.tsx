import { describe, it, expect, vi } from 'vitest'
import type { ReactNode } from 'react'
import { renderHook, act } from '@testing-library/react'
import { ToastProvider } from '../components/ui/Toast'
import { useEditForm } from './useEditForm'

type Form = { title: string; summary: string }

const mutation = { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }
const toPayload = (f: Form) => f
const onSuccess = () => {}

function wrapper({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>
}

function renderForm(initialState: Form) {
  return renderHook(
    ({ initial }: { initial: Form }) =>
      useEditForm({
        entityId: 's1',
        initialState: initial,
        mutation,
        toPayload,
        successMessage: 'Saved',
        entityName: 'story',
        onSuccess,
      }),
    { wrapper, initialProps: { initial: initialState } },
  )
}

describe('useEditForm', () => {
  it('shows the new loaded data when it arrives and nothing was edited', () => {
    const { result, rerender } = renderForm({ title: 'Old title', summary: '' })

    // The story query refetched in the background after an assessment
    rerender({ initial: { title: 'New title', summary: 'Assessed summary' } })

    expect(result.current.form).toEqual({ title: 'New title', summary: 'Assessed summary' })
    expect(result.current.isDirty).toBe(false)
  })

  it('keeps the edits when new loaded data arrives after an edit', () => {
    const { result, rerender } = renderForm({ title: 'Old title', summary: '' })

    act(() => result.current.set('title', 'Edited title'))
    rerender({ initial: { title: 'New title', summary: 'Assessed summary' } })

    expect(result.current.form).toEqual({ title: 'Edited title', summary: '' })
    expect(result.current.isDirty).toBe(true)
  })

  it('keeps the edits when the loaded data is rebuilt with the same values', () => {
    const { result, rerender } = renderForm({ title: 'Old title', summary: '' })

    act(() => result.current.set('summary', 'Typed'))
    rerender({ initial: { title: 'Old title', summary: '' } })

    expect(result.current.form).toEqual({ title: 'Old title', summary: 'Typed' })
    expect(result.current.isDirty).toBe(true)
  })

  it('follows a second refetch once the first one was taken over', () => {
    const { result, rerender } = renderForm({ title: 'A', summary: '' })

    rerender({ initial: { title: 'B', summary: '' } })
    rerender({ initial: { title: 'C', summary: 'x' } })

    expect(result.current.form).toEqual({ title: 'C', summary: 'x' })
  })
})

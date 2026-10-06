import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider, useToast } from './Toast'

function LinkedConsumer() {
  const { addProgressToast, updateToast } = useToast()
  return (
    <div>
      <button onClick={() => addProgressToast('pod', 'Voicing 1/5', { href: '/admin/podcasts/pod-1' })}>start</button>
      <button onClick={() => updateToast('pod', { type: 'error', message: 'Episode failed', sticky: true })}>fail</button>
      <button onClick={() => updateToast('pod', { type: 'success', message: 'Episode ready' })}>succeed</button>
    </div>
  )
}

function TestConsumer() {
  const { toast, addProgressToast, updateToast, removeToast } = useToast()
  return (
    <div>
      <button onClick={() => toast('success', 'Done!')}>success</button>
      <button onClick={() => toast('error', 'Failed!')}>error</button>
      <button onClick={() => addProgressToast('task-1', 'Working...')}>progress</button>
      <button onClick={() => updateToast('task-1', { message: 'Working... 3/5' })}>update-msg</button>
      <button onClick={() => updateToast('task-1', { type: 'success', message: 'All done' })}>finish</button>
      <button onClick={() => removeToast('task-1')}>remove</button>
    </div>
  )
}

function renderWithProvider() {
  return render(
    <ToastProvider>
      <TestConsumer />
    </ToastProvider>,
  )
}

describe('Toast', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders a success toast', () => {
    renderWithProvider()
    fireEvent.click(screen.getByText('success'))
    expect(screen.getByText('Done!')).toBeInTheDocument()
  })

  it('renders an error toast', () => {
    renderWithProvider()
    fireEvent.click(screen.getByText('error'))
    expect(screen.getByText('Failed!')).toBeInTheDocument()
  })

  it('auto-dismisses success/error toasts after 4 seconds', () => {
    vi.useFakeTimers()
    renderWithProvider()
    fireEvent.click(screen.getByText('success'))
    expect(screen.getByText('Done!')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(4000) })
    expect(screen.queryByText('Done!')).not.toBeInTheDocument()
    vi.useRealTimers()
  })

  it('renders a progress toast that does not auto-dismiss', () => {
    vi.useFakeTimers()
    renderWithProvider()
    fireEvent.click(screen.getByText('progress'))
    expect(screen.getByText('Working...')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(10000) })
    expect(screen.getByText('Working...')).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('updates a toast message in place', () => {
    renderWithProvider()
    fireEvent.click(screen.getByText('progress'))
    expect(screen.getByText('Working...')).toBeInTheDocument()
    fireEvent.click(screen.getByText('update-msg'))
    expect(screen.getByText('Working... 3/5')).toBeInTheDocument()
    expect(screen.queryByText('Working...')).not.toBeInTheDocument()
  })

  it('transitions progress toast to success and starts auto-dismiss', () => {
    vi.useFakeTimers()
    renderWithProvider()
    fireEvent.click(screen.getByText('progress'))
    fireEvent.click(screen.getByText('finish'))
    expect(screen.getByText('All done')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(4000) })
    expect(screen.queryByText('All done')).not.toBeInTheDocument()
    vi.useRealTimers()
  })

  it('manually removes a toast', () => {
    renderWithProvider()
    fireEvent.click(screen.getByText('progress'))
    expect(screen.getByText('Working...')).toBeInTheDocument()
    fireEvent.click(screen.getByText('remove'))
    expect(screen.queryByText('Working...')).not.toBeInTheDocument()
  })

  it('dismiss button removes a toast', () => {
    renderWithProvider()
    fireEvent.click(screen.getByText('success'))
    const dismissBtn = screen.getByLabelText('Dismiss')
    fireEvent.click(dismissBtn)
    expect(screen.queryByText('Done!')).not.toBeInTheDocument()
  })

  it('keeps a sticky outcome until it is dismissed', () => {
    vi.useFakeTimers()
    render(<ToastProvider><LinkedConsumer /></ToastProvider>, { wrapper: MemoryRouter })
    fireEvent.click(screen.getByText('start'))
    fireEvent.click(screen.getByText('fail'))
    act(() => { vi.advanceTimersByTime(10000) })
    expect(screen.getByText('Episode failed')).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('renders a toast with an href as a link to that page, kept on update', () => {
    render(<ToastProvider><LinkedConsumer /></ToastProvider>, { wrapper: MemoryRouter })
    fireEvent.click(screen.getByText('start'))
    expect(screen.getByRole('link', { name: 'Voicing 1/5' }).getAttribute('href')).toBe('/admin/podcasts/pod-1')
    fireEvent.click(screen.getByText('fail'))
    expect(screen.getByRole('link', { name: 'Episode failed' }).getAttribute('href')).toBe('/admin/podcasts/pod-1')
  })

  it('a progress toast restarted after an outcome is not dismissed by the outcome\'s timer', () => {
    vi.useFakeTimers()
    render(<ToastProvider><LinkedConsumer /></ToastProvider>, { wrapper: MemoryRouter })
    fireEvent.click(screen.getByText('start'))
    fireEvent.click(screen.getByText('succeed'))
    fireEvent.click(screen.getByText('start'))
    act(() => { vi.advanceTimersByTime(10000) })
    expect(screen.getByText('Voicing 1/5')).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('addProgressToast updates existing toast with same ID', () => {
    renderWithProvider()
    fireEvent.click(screen.getByText('progress'))
    expect(screen.getByText('Working...')).toBeInTheDocument()
    // Click again — should update, not create duplicate
    fireEvent.click(screen.getByText('progress'))
    const toasts = screen.getAllByText('Working...')
    expect(toasts).toHaveLength(1)
  })
})

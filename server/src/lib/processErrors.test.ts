import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockLog = vi.hoisted(() => ({ fatal: vi.fn(), warn: vi.fn() }))
const mockFlush = vi.hoisted(() => vi.fn((cb: () => void) => cb()))
vi.mock('./logger.js', () => ({ createLogger: () => mockLog, logger: { flush: mockFlush } }))

const mockNotify = vi.hoisted(() => vi.fn())
vi.mock('./notify.js', () => ({ notify: mockNotify }))

const { handleFatal, installProcessErrorHandlers, crashNotice, FATAL_NOTICE_WAIT_MS, _resetFatalState } = await import('./processErrors.js')

describe('handleFatal', () => {
  const exit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never)

  beforeEach(() => {
    vi.clearAllMocks()
    _resetFatalState()
    mockNotify.mockResolvedValue(undefined)
    mockFlush.mockImplementation((cb: () => void) => cb())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('logs the error at fatal level, records an admin notice, then exits with 1', async () => {
    const err = new Error('boom')
    await handleFatal('unhandledRejection', err)

    expect(mockLog.fatal).toHaveBeenCalledWith({ err, kind: 'unhandledRejection' }, expect.any(String))
    expect(mockNotify).toHaveBeenCalledWith(crashNotice('unhandledRejection', err))
    expect(mockFlush).toHaveBeenCalled()
    expect(exit).toHaveBeenCalledWith(1)
    // Logged before anything that could hang
    expect(mockLog.fatal.mock.invocationCallOrder[0]).toBeLessThan(mockNotify.mock.invocationCallOrder[0]!)
  })

  it('exits after the bounded wait when the notice hangs (a database that is down)', async () => {
    vi.useFakeTimers()
    mockNotify.mockReturnValue(new Promise(() => {}))

    const done = handleFatal('uncaughtException', new Error('db gone'))
    await vi.advanceTimersByTimeAsync(FATAL_NOTICE_WAIT_MS - 1)
    expect(exit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2000)
    await done

    expect(exit).toHaveBeenCalledWith(1)
  })

  it('still exits when the notice rejects', async () => {
    mockNotify.mockRejectedValue(new Error('broken contract'))
    await handleFatal('unhandledRejection', new Error('boom'))
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('exits at once on a second fatal error while the first is being handled', async () => {
    mockNotify.mockReturnValue(new Promise(() => {}))
    void handleFatal('unhandledRejection', new Error('first'))

    await handleFatal('uncaughtException', new Error('second'))

    expect(exit).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledWith(1)
    expect(mockNotify).toHaveBeenCalledTimes(1)
  })

  it('handles a rejection reason that is not an Error', async () => {
    await handleFatal('unhandledRejection', 'plain string')
    expect(mockLog.fatal).toHaveBeenCalledWith({ err: 'plain string', kind: 'unhandledRejection' }, expect.any(String))
    expect(exit).toHaveBeenCalledWith(1)
  })
})

describe('crashNotice', () => {
  it('names the kind and the error type, but never the error message (it may quote personal data)', () => {
    const err = Object.assign(new TypeError('cannot read user@example.com'), { code: 'E_X' })
    const notice = crashNotice('uncaughtException', err)

    expect(notice).toMatchObject({ source: 'jobs', severity: 'critical', dedupeKey: 'process-crash', link: '/admin/jobs' })
    expect(notice.message).toContain('uncaughtException')
    expect(notice.message).toContain('TypeError')
    expect(notice.message).toContain('E_X')
    expect(notice.message).not.toContain('user@example.com')
  })

  it('names the type of a non-Error reason', () => {
    expect(crashNotice('unhandledRejection', 42).message).toContain('number')
  })
})

describe('installProcessErrorHandlers', () => {
  it('registers handlers for unhandled rejections and uncaught exceptions', () => {
    const on = vi.spyOn(process, 'on').mockImplementation((() => process) as never)
    installProcessErrorHandlers()
    const events = on.mock.calls.map(([event]) => event)
    expect(events).toContain('unhandledRejection')
    expect(events).toContain('uncaughtException')
    on.mockRestore()
  })
})

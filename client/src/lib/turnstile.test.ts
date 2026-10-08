import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runTurnstileChallenge, TURNSTILE_TIMEOUT_MS, type TurnstileRenderOptions } from './turnstile'

function stubTurnstile() {
  const rendered: TurnstileRenderOptions[] = []
  const api = {
    render: vi.fn((_el: HTMLElement, options: TurnstileRenderOptions) => {
      rendered.push(options)
      return `widget-${rendered.length}`
    }),
    execute: vi.fn(),
    remove: vi.fn(),
  }
  return { api, rendered }
}

const scriptTags = () => document.head.querySelectorAll('script[src*="challenges.cloudflare.com/turnstile"]')

describe('runTurnstileChallenge', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    delete window.turnstile
    scriptTags().forEach((s) => s.remove())
    container = document.createElement('div')
  })

  afterEach(() => {
    delete window.turnstile
  })

  it('injects the script once for two concurrent challenges', async () => {
    const { api } = stubTurnstile()
    runTurnstileChallenge(container, 'k')
    runTurnstileChallenge(container, 'k')

    const tags = scriptTags()
    expect(tags).toHaveLength(1)

    window.turnstile = api
    tags[0].dispatchEvent(new Event('load'))
    await vi.waitFor(() => expect(api.render).toHaveBeenCalledTimes(2))
  })

  it('renders an on-demand, interaction-only widget, executes it and resolves with its token', async () => {
    const { api, rendered } = stubTurnstile()
    window.turnstile = api

    const { token } = runTurnstileChallenge(container, 'site-key')
    await vi.waitFor(() => expect(rendered).toHaveLength(1))

    expect(rendered[0]).toMatchObject({
      sitekey: 'site-key',
      execution: 'execute',
      appearance: 'interaction-only',
    })
    expect(api.execute).toHaveBeenCalledWith(container)

    rendered[0].callback('tok')
    await expect(token).resolves.toBe('tok')
    expect(api.remove).toHaveBeenCalledWith('widget-1')
  })

  it.each(['error-callback', 'timeout-callback', 'unsupported-callback'] as const)(
    'rejects and removes the widget on %s',
    async (event) => {
      const { api, rendered } = stubTurnstile()
      window.turnstile = api

      const { token } = runTurnstileChallenge(container, 'k')
      await vi.waitFor(() => expect(rendered).toHaveLength(1))
      rendered[0][event]()

      await expect(token).rejects.toThrow()
      expect(api.remove).toHaveBeenCalledWith('widget-1')
    },
  )

  it('rejects when the script fails to load, and a later challenge tries again', async () => {
    const first = runTurnstileChallenge(container, 'k')
    scriptTags()[0].dispatchEvent(new Event('error'))
    await expect(first.token).rejects.toThrow()
    expect(scriptTags()).toHaveLength(0)

    const second = runTurnstileChallenge(container, 'k')
    expect(scriptTags()).toHaveLength(1)
    // Settle the shared load so it does not leak into the next test.
    scriptTags()[0].dispatchEvent(new Event('error'))
    await expect(second.token).rejects.toThrow()
  })

  it('rejects when rendering throws (e.g. a malformed site key)', async () => {
    const { api } = stubTurnstile()
    api.render.mockImplementation(() => {
      throw new Error('Invalid sitekey')
    })
    window.turnstile = api

    await expect(runTurnstileChallenge(container, 'bad').token).rejects.toThrow()
  })

  it('rejects and removes the widget when nothing settles within the time limit', async () => {
    vi.useFakeTimers()
    try {
      const { api } = stubTurnstile()
      window.turnstile = api
      const { token } = runTurnstileChallenge(container, 'k')
      const outcome = token.catch((err: Error) => err)

      await vi.advanceTimersByTimeAsync(TURNSTILE_TIMEOUT_MS)

      expect(await outcome).toBeInstanceOf(Error)
      expect(api.remove).toHaveBeenCalledWith('widget-1')
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancel removes the widget and rejects the pending token', async () => {
    const { api, rendered } = stubTurnstile()
    window.turnstile = api

    const challenge = runTurnstileChallenge(container, 'k')
    await vi.waitFor(() => expect(rendered).toHaveLength(1))
    challenge.cancel()

    await expect(challenge.token).rejects.toThrow()
    expect(api.remove).toHaveBeenCalledWith('widget-1')
  })

  it('cancel before the script loads renders nothing', async () => {
    const { api } = stubTurnstile()
    const challenge = runTurnstileChallenge(container, 'k')
    challenge.cancel()
    await expect(challenge.token).rejects.toThrow()

    window.turnstile = api
    scriptTags()[0].dispatchEvent(new Event('load'))
    await new Promise((r) => setTimeout(r, 0))
    expect(api.render).not.toHaveBeenCalled()
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import TurnstileWidget from './TurnstileWidget'

type RenderOptions = {
  callback: (token: string) => void
  'expired-callback': () => void
  'error-callback': () => void
}

function stubTurnstile() {
  const rendered: RenderOptions[] = []
  const api = {
    render: vi.fn((_el: HTMLElement, options: RenderOptions) => {
      rendered.push(options)
      return `widget-${rendered.length}`
    }),
    remove: vi.fn(),
  }
  return { api, rendered }
}

const scriptTags = () => document.head.querySelectorAll('script[src*="challenges.cloudflare.com/turnstile"]')

describe('TurnstileWidget', () => {
  beforeEach(() => {
    delete window.turnstile
    scriptTags().forEach((s) => s.remove())
  })

  afterEach(() => {
    delete window.turnstile
  })

  it('injects the script once for two widgets and renders both once it loads', async () => {
    const { api } = stubTurnstile()
    render(
      <>
        <TurnstileWidget siteKey="k" onToken={vi.fn()} onError={vi.fn()} />
        <TurnstileWidget siteKey="k" onToken={vi.fn()} onError={vi.fn()} />
      </>,
    )

    const tags = scriptTags()
    expect(tags).toHaveLength(1)

    window.turnstile = api
    tags[0].dispatchEvent(new Event('load'))

    await waitFor(() => expect(api.render).toHaveBeenCalledTimes(2))
  })

  it('reports tokens, expiry and widget errors', async () => {
    const { api, rendered } = stubTurnstile()
    window.turnstile = api
    const onToken = vi.fn()
    const onError = vi.fn()
    render(<TurnstileWidget siteKey="k" onToken={onToken} onError={onError} />)
    await waitFor(() => expect(rendered).toHaveLength(1))

    rendered[0].callback('tok')
    expect(onToken).toHaveBeenLastCalledWith('tok')

    rendered[0]['expired-callback']()
    expect(onToken).toHaveBeenLastCalledWith(null)

    rendered[0]['error-callback']()
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('removes its widget on unmount', async () => {
    const { api } = stubTurnstile()
    window.turnstile = api
    const { unmount } = render(<TurnstileWidget siteKey="k" onToken={vi.fn()} onError={vi.fn()} />)
    await waitFor(() => expect(api.render).toHaveBeenCalled())

    unmount()

    expect(api.remove).toHaveBeenCalledWith('widget-1')
  })
})

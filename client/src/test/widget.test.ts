import { describe, it, expect, afterEach } from 'vitest'
import widgetSource from '../../public/widget.js?raw'

const AI_HEADER = 'AI-generated headlines from Actually Relevant'

/** Stand-in for the XHR the widget sends to the public API: answers with one story. */
class FakeXhr {
  status = 200
  responseText = JSON.stringify({
    data: [{ id: 's1', slug: 's1', title: 'AI headline', sourceTitle: 'Source', feed: { title: 'Feed' }, datePublished: null, dateCrawled: '2026-09-20T00:00:00Z' }],
  })
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  open() {}
  send() {
    this.onload?.()
  }
}

/**
 * Run widget.js as an embedding page does: from a <script> tag with data attributes, which the
 * widget finds through document.currentScript. It runs with the fake XHR passed in place of the
 * global, so the test never sends a real request to the API.
 */
function runWidget(attributes: Record<string, string> = {}): ShadowRoot {
  const script = document.createElement('script')
  for (const [name, value] of Object.entries(attributes)) script.setAttribute(name, value)
  document.body.appendChild(script)

  const doc = new Proxy(document, {
    get(target, prop) {
      if (prop === 'currentScript') return script
      const value = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  new Function('document', 'XMLHttpRequest', widgetSource)(doc, FakeXhr)

  const container = script.nextElementSibling as HTMLElement
  return container.shadowRoot!
}

describe('widget.js AI header', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('labels the headlines at the top of the widget, before the first story', () => {
    const shadow = runWidget()
    const header = shadow.querySelector('.ar-header')!
    expect(header.textContent).toBe(`AI${AI_HEADER}`)
    expect(header.querySelector('.ar-badge')?.getAttribute('aria-hidden')).toBe('true')
    const firstStory = shadow.querySelector('.ar-item')!
    expect(header.compareDocumentPosition(firstStory) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps the AI line when the embedding site sets its own title', () => {
    const shadow = runWidget({ 'data-title': 'Good news' })
    const header = shadow.querySelector('.ar-header')!
    expect(header.querySelector('.ar-header-title')?.textContent).toBe('Good news')
    expect(header.querySelector('.ar-header-ai')?.textContent).toBe(`AI${AI_HEADER}`)
  })

  it('keeps the "Powered by" footer', () => {
    const shadow = runWidget()
    expect(shadow.querySelector('.ar-footer')?.textContent).toBe('Powered by Actually Relevant')
  })
})

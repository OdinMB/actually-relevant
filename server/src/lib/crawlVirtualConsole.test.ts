import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { JSDOM } from 'jsdom'

const mockWarn = vi.hoisted(() => vi.fn())
vi.mock('./logger.js', () => ({ createLogger: () => ({ warn: mockWarn, info: vi.fn(), error: vi.fn(), debug: vi.fn() }) }))

const { crawlVirtualConsole } = await import('./crawlVirtualConsole.js')

const URL = 'https://example.com/article'
// CSS jsdom's parser rejects: a stray brace and a custom property holding a block
const BAD_CSS_PAGE = '<html><head><style>.a { color: red; } } .b { --x: { a: b } }</style></head><body><p>Hi</p></body></html>'

describe('crawlVirtualConsole', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    stderrSpy.mockRestore()
    consoleErrorSpy.mockRestore()
  })

  it('jsdom reports unparseable CSS by default (the noise this console removes)', () => {
    const seen: string[] = []
    const vc = crawlVirtualConsole(URL)
    vc.on('jsdomError', (e: Error & { type?: string }) => seen.push(e.type ?? ''))
    new JSDOM(BAD_CSS_PAGE, { url: URL, virtualConsole: vc }).window.close()
    expect(seen).toContain('css-parsing')
  })

  it('drops CSS parse errors without logging or printing them', () => {
    const dom = new JSDOM(BAD_CSS_PAGE, { url: URL, virtualConsole: crawlVirtualConsole(URL) })
    expect(dom.window.document.querySelector('p')?.textContent).toBe('Hi')
    dom.window.close()
    expect(mockWarn).not.toHaveBeenCalled()
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('logs any other jsdom error as a warning naming the page', () => {
    const vc = crawlVirtualConsole(URL)
    vc.emit('jsdomError', Object.assign(new Error('Could not load img'), { type: 'resource-loading' }))
    expect(mockWarn).toHaveBeenCalledWith({ url: URL, type: 'resource-loading', reason: 'Could not load img' }, 'jsdom reported an error while parsing a page')
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('ignores the page console', () => {
    const vc = crawlVirtualConsole(URL)
    vc.emit('error', 'page script said something')
    expect(mockWarn).not.toHaveBeenCalled()
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })
})

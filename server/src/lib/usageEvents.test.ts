import { describe, it, expect } from 'vitest'
import { countedRoute, ownSiteHosts, usageEvent, type UsageRequest } from './usageEvents.js'

const OWN_HOSTS = ['actuallyrelevant.news']

/** A plain outside call of the story list: no Origin, no Referer, answered 200. */
function request(overrides: Partial<UsageRequest> = {}): UsageRequest {
  return {
    method: 'GET',
    path: '/api/stories',
    origin: undefined,
    referer: undefined,
    fromWidget: false,
    issueSlug: undefined,
    doNotTrack: false,
    status: 200,
    ...overrides,
  }
}

describe('countedRoute', () => {
  it.each([
    ['/api/stories', '/api/stories'],
    ['/api/stories/a-story-slug', '/api/stories/:slug'],
    ['/api/stories/a-story-slug/related', '/api/stories/:slug/related'],
    ['/api/stories/a-story-slug/cluster', '/api/stories/:slug/cluster'],
    ['/api/stories/a-story-slug/appearances', '/api/stories/:slug/appearances'],
    ['/api/homepage', '/api/homepage'],
    ['/api/issues', '/api/issues'],
    ['/api/issues/planet-climate', '/api/issues/:slug'],
    ['/api/sources', '/api/sources'],
    ['/api/newsletters', '/api/newsletters'],
    ['/api/newsletters/2026-11-01-the-week', '/api/newsletters/:slug'],
    ['/api/podcast', '/api/podcast'],
    ['/api/podcast/episodes/0b6f4a5e-6d0e-4c43-9a43-6c1c2f1d8e11', '/api/podcast/episodes/:id'],
    ['/api/docs/openapi.json', '/api/docs/openapi.json'],
  ])('counts %s as %s, never with the id or slug itself', (path, pattern) => {
    expect(countedRoute(path)).toBe(pattern)
  })

  it('ignores a trailing slash and letter case, as Express routing does', () => {
    expect(countedRoute('/api/stories/')).toBe('/api/stories')
    expect(countedRoute('/API/Issues/Planet-Climate')).toBe('/api/issues/:slug')
  })

  it.each([
    '/health',
    '/api/admin/stories',
    '/api/auth/login',
    '/api/story-page/a-story-slug',
    '/api/page/newsletter/2026-11-01-the-week',
    '/api/feeds/0b6f4a5e-6d0e-4c43-9a43-6c1c2f1d8e11/favicon',
    '/api/feed',
    '/api/feed/planet-climate',
    '/api/newsletters/feed.xml',
    '/api/podcast/feed.xml',
    '/api/stories/a-story-slug/og.png',
    '/api/section-images/newsletter.png',
    '/api/subscribe/token',
    '/api/feedback/token',
    '/api/sitemap.xml',
    '/api/unknown',
    '/api/stories/a/b/c',
    '/api/stories//related',
  ])('counts no %s', path => {
    expect(countedRoute(path)).toBeNull()
  })
})

describe('ownSiteHosts', () => {
  it('takes each configured address once, without www., skipping empty and unreadable ones', () => {
    expect(ownSiteHosts(['https://actuallyrelevant.news', 'https://www.actuallyrelevant.news/', '', 'not a url'])).toEqual(['actuallyrelevant.news'])
  })
})

describe('usageEvent', () => {
  describe('an outside call of the public API', () => {
    it('is an api_request with its route, the calling site from Origin, and the status', () => {
      expect(usageEvent(request({ path: '/api/stories/a-story-slug', origin: 'https://news.example.org', status: 404 }), OWN_HOSTS)).toEqual({
        event: 'api_request',
        metadata: { route: '/api/stories/:slug', caller: 'news.example.org', status: 404 },
      })
    })

    it('takes the calling site from Referer when there is no Origin, without its path or query', () => {
      const event = usageEvent(request({ referer: 'https://blog.example.com/post/1?reader=jane' }), OWN_HOSTS)
      expect(event?.metadata.caller).toBe('blog.example.com')
    })

    it('names a caller with neither header "direct" (server-to-server)', () => {
      expect(usageEvent(request(), OWN_HOSTS)?.metadata.caller).toBe('direct')
    })

    it('reads an opaque or non-web origin as no origin', () => {
      expect(usageEvent(request({ origin: 'null' }), OWN_HOSTS)?.metadata.caller).toBe('direct')
      expect(usageEvent(request({ origin: 'chrome-extension://abcdefghijklmnop' }), OWN_HOSTS)?.metadata.caller).toBe('direct')
      expect(usageEvent(request({ origin: 'null', referer: 'https://blog.example.com/' }), OWN_HOSTS)?.metadata.caller).toBe('blog.example.com')
    })

    it('never sends a site addressed by IP, which can name a person', () => {
      expect(usageEvent(request({ origin: 'http://203.0.113.7:8080' }), OWN_HOSTS)?.metadata.caller).toBe('ip-address')
      expect(usageEvent(request({ referer: 'http://[2001:db8::1]/page' }), OWN_HOSTS)?.metadata.caller).toBe('ip-address')
    })

    it('counts a site whose name merely ends like ours', () => {
      expect(usageEvent(request({ origin: 'https://notactuallyrelevant.news' }), OWN_HOSTS)?.metadata.caller).toBe('notactuallyrelevant.news')
    })
  })

  describe('a call from our own site', () => {
    it.each(['https://actuallyrelevant.news', 'https://www.actuallyrelevant.news', 'https://api.actuallyrelevant.news'])('is not counted from %s', origin => {
      expect(usageEvent(request({ origin }), OWN_HOSTS)).toBeNull()
      expect(usageEvent(request({ referer: `${origin}/issues/planet-climate` }), OWN_HOSTS)).toBeNull()
    })

    it.each(['http://localhost:8000', 'http://127.0.0.1:5173', 'http://[::1]:4173'])(
      'is not counted from the loopback origin %s (the build prerender, local development)',
      origin => {
        expect(usageEvent(request({ origin }), OWN_HOSTS)).toBeNull()
      },
    )
  })

  describe('a widget load', () => {
    it('is a widget_view with the embedding site and the issue filter, not also an api_request', () => {
      const event = usageEvent(request({ fromWidget: true, origin: 'https://blog.example.com', issueSlug: 'planet-climate' }), OWN_HOSTS)
      expect(event).toEqual({ event: 'widget_view', metadata: { site: 'blog.example.com', issue: 'planet-climate' } })
    })

    it('names the site "unknown" when the browser sent neither Origin nor Referer, and leaves out an absent filter', () => {
      expect(usageEvent(request({ fromWidget: true }), OWN_HOSTS)).toEqual({ event: 'widget_view', metadata: { site: 'unknown' } })
    })

    it('leaves out an issue filter that is not shaped like an issue slug', () => {
      const event = usageEvent(request({ fromWidget: true, origin: 'https://blog.example.com', issueSlug: 'Jane Doe <jane@example.com>' }), OWN_HOSTS)
      expect(event).toEqual({ event: 'widget_view', metadata: { site: 'blog.example.com' } })
    })

    it('is not counted on our own site (the widget page preview)', () => {
      expect(usageEvent(request({ fromWidget: true, origin: 'https://actuallyrelevant.news' }), OWN_HOSTS)).toBeNull()
    })

    it('is an ordinary api_request when the marker comes with another route', () => {
      expect(usageEvent(request({ fromWidget: true, path: '/api/issues', origin: 'https://blog.example.com' }), OWN_HOSTS)?.event).toBe('api_request')
    })
  })

  it('counts nothing for a browser that asks not to be tracked', () => {
    expect(usageEvent(request({ doNotTrack: true, origin: 'https://news.example.org' }), OWN_HOSTS)).toBeNull()
    expect(usageEvent(request({ doNotTrack: true, fromWidget: true, origin: 'https://blog.example.com' }), OWN_HOSTS)).toBeNull()
  })

  it('counts only GET requests', () => {
    expect(usageEvent(request({ method: 'HEAD' }), OWN_HOSTS)).toBeNull()
    expect(usageEvent(request({ method: 'POST', path: '/api/stories' }), OWN_HOSTS)).toBeNull()
  })

  it('counts nothing on a route outside the counted ones', () => {
    expect(usageEvent(request({ path: '/api/feed', origin: 'https://news.example.org' }), OWN_HOSTS)).toBeNull()
  })
})

import { createHash } from 'node:crypto'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockUplifting = vi.hoisted(() => ({ enabled: false, artworkUrl: '' }))

vi.mock('../config.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../config.js')>()
  const uplifting = { ...actual.config.podcast.uplifting }
  Object.defineProperty(uplifting, 'enabled', { get: () => mockUplifting.enabled })
  Object.defineProperty(uplifting, 'artworkUrl', { get: () => mockUplifting.artworkUrl })
  return { ...actual, config: { ...actual.config, podcast: { ...actual.config.podcast, uplifting } } }
})

const { upliftingShowProblem, isEditionOpen, openEditions, editionRunRefusal, editionClosedReason, podcastEditionInfo, episodeNoticeTitle } =
  await import('./podcastEdition.js')

const OPEN = { enabled: true, copyConfirmed: true, artworkUrl: 'https://audio.example/show/uplifting.jpg' }

/** RFC 4122 UUIDv5, as the Podcasting 2.0 spec derives `podcast:guid` from the feed URL without its scheme. */
function uuidv5(namespace: string, name: string): string {
  const hash = createHash('sha1')
    .update(Buffer.concat([Buffer.from(namespace.replace(/-/g, ''), 'hex'), Buffer.from(name, 'utf8')]))
    .digest()
  hash[6] = (hash[6]! & 0x0f) | 0x50
  hash[8] = (hash[8]! & 0x3f) | 0x80
  const hex = hash.subarray(0, 16).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
const PODCASTING_2_NAMESPACE = 'ead4c236-bf58-58c6-a2c6-a6b28d128cb6'

beforeEach(() => {
  mockUplifting.enabled = false
  mockUplifting.artworkUrl = ''
})

describe('upliftingShowProblem', () => {
  it('is null once the variable is on, the copy confirmed and the artwork set', () => {
    expect(upliftingShowProblem(OPEN)).toBeNull()
  })

  it.each([
    ['the variable off', { enabled: false }, 'PODCAST_UPLIFTING_ENABLED'],
    ['the copy unconfirmed', { copyConfirmed: false }, 'PODCAST_UPLIFTING_COPY_CONFIRMED'],
    ['no artwork', { artworkUrl: '' }, 'config.podcast.uplifting.artworkUrl'],
  ])('names %s', (_label, change, named) => {
    const problem = upliftingShowProblem({ ...OPEN, ...change })
    expect(problem).toContain(named)
  })

  it('names every missing precondition at once', () => {
    const problem = upliftingShowProblem({ enabled: false, copyConfirmed: false, artworkUrl: '' })
    for (const named of ['PODCAST_UPLIFTING_ENABLED', 'PODCAST_UPLIFTING_COPY_CONFIRMED', 'artworkUrl']) expect(problem).toContain(named)
  })

  it('reads the live settings by default: closed while the copy awaits confirmation, even with the variable on and artwork set', () => {
    mockUplifting.enabled = true
    mockUplifting.artworkUrl = OPEN.artworkUrl
    expect(upliftingShowProblem()).toContain('PODCAST_UPLIFTING_COPY_CONFIRMED')
    expect(upliftingShowProblem()).not.toContain('PODCAST_UPLIFTING_ENABLED')
  })
})

describe('isEditionOpen and openEditions', () => {
  it('keeps the main show open always, and the uplifting one closed while a precondition is missing', () => {
    expect(isEditionOpen('full')).toBe(true)
    expect(editionClosedReason('full')).toBeNull()
    expect(isEditionOpen('uplifting')).toBe(false)
    expect(editionClosedReason('uplifting')).toBe(upliftingShowProblem())
    expect(openEditions()).toEqual(['full'])
  })
})

describe('editionRunRefusal', () => {
  it('never refuses the main show', () => {
    expect(editionRunRefusal('full', false)).toBeNull()
    expect(editionRunRefusal('full', true)).toBeNull()
  })

  it('lets a dry run of the uplifting show start on the variable alone', () => {
    mockUplifting.enabled = true
    expect(editionRunRefusal('uplifting', true)).toBeNull()
  })

  it('refuses a dry run while the variable is off, and a live run while the show is closed', () => {
    expect(editionRunRefusal('uplifting', true)).toContain('PODCAST_UPLIFTING_ENABLED')
    mockUplifting.enabled = true
    mockUplifting.artworkUrl = OPEN.artworkUrl
    expect(editionRunRefusal('uplifting', false)).toContain('PODCAST_UPLIFTING_COPY_CONFIRMED')
  })
})

describe('podcastEditionInfo', () => {
  it("derives each show's channel GUID from its production feed address (Podcasting 2.0), whatever SITE_URL says", () => {
    for (const edition of ['full', 'uplifting'] as const) {
      const info = podcastEditionInfo(edition)
      expect(info.feedGuid).toBe(uuidv5(PODCASTING_2_NAMESPACE, `actuallyrelevant.news${info.feedPath}`))
    }
  })

  it('gives the two shows different jobs, feeds, GUIDs and storage prefixes', () => {
    const [full, uplifting] = [podcastEditionInfo('full'), podcastEditionInfo('uplifting')]
    for (const key of ['generateJob', 'publishJob', 'feedPath', 'pagePath', 'feedGuid', 'objectPrefix'] as const) {
      expect(uplifting[key]).not.toBe(full[key])
    }
  })
})

describe('episodeNoticeTitle', () => {
  it('names the show in front of the event, capitalized', () => {
    expect(episodeNoticeTitle('full', 'ready')).toBe('Podcast episode ready')
    expect(episodeNoticeTitle('uplifting', 'ready')).toBe('Actually Uplifting episode ready')
  })
})

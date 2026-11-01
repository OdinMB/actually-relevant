import { describe, it, expect } from 'vitest'
import { countResults, planChangeset, type ChangesetSnapshot, type SnapshotFeed } from './feedChangesetPlan.js'

const CLIMATE = '00000000-0000-0000-0000-0000000000c1'
const HEALTH = '00000000-0000-0000-0000-0000000000c2'
const SIPRI_ID = '00000000-0000-0000-0000-0000000000f1'
const LANCET_ID = '00000000-0000-0000-0000-0000000000f2'
const EMPTY_ID = '00000000-0000-0000-0000-0000000000f3'

function feed(overrides: Partial<SnapshotFeed> & Pick<SnapshotFeed, 'id' | 'title' | 'rssUrl'>): SnapshotFeed {
  return {
    url: null,
    displayTitle: null,
    language: 'en',
    region: null,
    issueId: CLIMATE,
    crawlIntervalHours: 24,
    htmlSelector: null,
    paywallDetection: true,
    paywallTitleMarker: null,
    contentSource: 'page',
    active: true,
    storyCount: 0,
    ...overrides,
  }
}

const sipri = feed({ id: SIPRI_ID, title: 'SIPRI', rssUrl: 'https://www.sipri.org/rss/old.xml', storyCount: 12 })
const lancet = feed({ id: LANCET_ID, title: 'The Lancet', rssUrl: 'https://www.thelancet.com/rss.xml', issueId: HEALTH, storyCount: 40 })
const twinA = feed({ id: 'f-twin-a', title: 'Twin', rssUrl: 'https://a.example/feed' })
const twinB = feed({ id: 'f-twin-b', title: 'Twin', rssUrl: 'https://b.example/feed' })
const empty = feed({ id: EMPTY_ID, title: 'Never crawled', rssUrl: 'https://empty.example/feed' })
const retired = feed({ id: 'f-retired', title: 'Retired', rssUrl: 'https://retired.example/feed', active: false, storyCount: 3 })

const snapshot: ChangesetSnapshot = {
  feeds: [sipri, lancet, twinA, twinB, empty, retired],
  issues: [
    { id: CLIMATE, slug: 'climate' },
    { id: HEALTH, slug: 'pandemics' },
  ],
}

const reason = 'Researched 2026-11-01'
const newFeed = { title: 'ECDC', rssUrl: 'https://www.ecdc.europa.eu/feed', issue: 'pandemics' }

describe('planChangeset', () => {
  it('resolves an update by title, rssUrl or id and writes only the fields that change', () => {
    const [byTitle, byUrl, byId] = planChangeset(
      [
        { action: 'update', match: { title: 'SIPRI' }, set: { rssUrl: 'https://www.sipri.org/rss/combined.xml', language: 'en' }, reason },
        { action: 'update', match: { rssUrl: 'https://www.thelancet.com/rss.xml' }, set: { issue: 'climate', contentSource: 'rss' }, reason },
        { action: 'update', match: { id: EMPTY_ID }, set: { displayTitle: 'Empty' }, reason },
      ],
      snapshot,
    )

    expect(byTitle?.result).toMatchObject({ index: 0, action: 'update', feedTitle: 'SIPRI', reason, status: 'ok' })
    expect(byTitle?.result.diff).toEqual([{ field: 'rssUrl', from: 'https://www.sipri.org/rss/old.xml', to: 'https://www.sipri.org/rss/combined.xml' }])
    expect(byTitle?.write).toEqual({ kind: 'update', feedId: SIPRI_ID, data: { rssUrl: 'https://www.sipri.org/rss/combined.xml' } })

    expect(byUrl?.result.diff).toEqual([
      { field: 'contentSource', from: 'page', to: 'rss' },
      { field: 'issue', from: 'pandemics', to: 'climate' },
    ])
    expect(byUrl?.write).toEqual({ kind: 'update', feedId: LANCET_ID, data: { issueId: CLIMATE, contentSource: 'rss' } })

    expect(byId?.result).toMatchObject({ feedTitle: 'Never crawled', status: 'ok' })
    expect(byId?.result.diff).toEqual([{ field: 'displayTitle', from: null, to: 'Empty' }])
  })

  it('reports an update that changes nothing as a noop, with no write', () => {
    const [planned] = planChangeset(
      [{ action: 'update', match: { title: 'SIPRI' }, set: { language: 'en', issue: 'climate', active: true }, reason }],
      snapshot,
    )

    expect(planned?.result.status).toBe('noop')
    expect(planned?.write).toBeNull()
  })

  it('refuses a match that finds no feed or several', () => {
    const [none, several, noId] = planChangeset(
      [
        { action: 'update', match: { title: 'sipri' }, set: { language: 'de' }, reason },
        { action: 'delete', match: { title: 'Twin' }, reason },
        { action: 'delete', match: { id: '00000000-0000-0000-0000-000000000999' }, reason },
      ],
      snapshot,
    )

    expect(none?.result).toMatchObject({ status: 'error', feedTitle: null })
    expect(none?.result.message).toContain('No feed is titled "sipri"')
    expect(several?.result.message).toContain('2 feeds are titled "Twin"')
    expect(noId?.result.message).toContain('No feed has id')
    expect([none, several, noId].map(p => p?.write)).toEqual([null, null, null])
  })

  it('refuses an unknown issue slug on create and update', () => {
    const [created, updated] = planChangeset(
      [
        { action: 'create', feed: { ...newFeed, issue: 'pandemic' }, reason },
        { action: 'update', match: { title: 'SIPRI' }, set: { issue: 'peace' }, reason },
      ],
      snapshot,
    )

    expect(created?.result).toMatchObject({ status: 'error', message: expect.stringContaining('Unknown issue "pandemic"') })
    expect(updated?.result).toMatchObject({ status: 'error', message: expect.stringContaining('Unknown issue "peace"') })
  })

  it('refuses an RSS URL another feed holds, in the database or earlier in the file', () => {
    const [againstDb, first, second, updateOntoOther] = planChangeset(
      [
        { action: 'create', feed: { ...newFeed, rssUrl: 'https://www.thelancet.com/rss.xml' }, reason },
        { action: 'create', feed: newFeed, reason },
        { action: 'create', feed: { ...newFeed, title: 'ECDC again' }, reason },
        { action: 'update', match: { title: 'SIPRI' }, set: { rssUrl: 'https://empty.example/feed' }, reason },
      ],
      snapshot,
    )

    expect(againstDb?.result).toMatchObject({ status: 'error', message: expect.stringContaining('feed "The Lancet"') })
    expect(first?.result.status).toBe('ok')
    expect(second?.result).toMatchObject({ status: 'error', message: expect.stringContaining('change #2') })
    expect(updateOntoOther?.result).toMatchObject({ status: 'error', message: expect.stringContaining('feed "Never crawled"') })
  })

  it('applies in file order: a URL an earlier change frees can be taken by a later one', () => {
    const planned = planChangeset(
      [
        { action: 'update', match: { title: 'SIPRI' }, set: { rssUrl: 'https://www.sipri.org/rss/combined.xml' }, reason },
        { action: 'create', feed: { ...newFeed, rssUrl: 'https://www.sipri.org/rss/old.xml' }, reason },
        { action: 'delete', match: { title: 'Never crawled' }, reason },
        { action: 'create', feed: { ...newFeed, title: 'Reused', rssUrl: 'https://empty.example/feed' }, reason },
      ],
      snapshot,
    )

    expect(planned.map(p => p.result.status)).toEqual(['ok', 'ok', 'ok', 'ok'])
  })

  it('keeps the URL of a feed a delete only deactivates', () => {
    const [, reuse] = planChangeset(
      [
        { action: 'delete', match: { title: 'SIPRI' }, reason },
        { action: 'create', feed: { ...newFeed, rssUrl: 'https://www.sipri.org/rss/old.xml' }, reason },
      ],
      snapshot,
    )

    expect(reuse?.result.status).toBe('error')
  })

  it('deletes a feed without stories, deactivates one with stories, and leaves an inactive one alone', () => {
    const [noStories, withStories, inactive] = planChangeset(
      [
        { action: 'delete', match: { title: 'Never crawled' }, reason },
        { action: 'delete', match: { title: 'The Lancet' }, reason },
        { action: 'delete', match: { title: 'Retired' }, reason },
      ],
      snapshot,
    )

    expect(noStories?.result).toMatchObject({ status: 'ok', message: expect.stringContaining('Deletes') })
    expect(noStories?.write).toEqual({ kind: 'delete', feedId: EMPTY_ID })
    expect(withStories?.result).toMatchObject({ status: 'ok', message: expect.stringContaining('Deactivates') })
    expect(withStories?.write).toEqual({ kind: 'delete', feedId: LANCET_ID })
    expect(inactive?.result.status).toBe('noop')
    expect(inactive?.write).toBeNull()
  })

  it('refuses a second change to the same feed', () => {
    const [, again] = planChangeset(
      [
        { action: 'update', match: { title: 'SIPRI' }, set: { language: 'de' }, reason },
        { action: 'delete', match: { id: SIPRI_ID }, reason },
      ],
      snapshot,
    )

    expect(again?.result).toMatchObject({ status: 'error', feedTitle: 'SIPRI', message: expect.stringContaining('change #1') })
  })

  it('creates a feed with its issue resolved to an id', () => {
    const [planned] = planChangeset([{ action: 'create', feed: { ...newFeed, contentSource: 'rss' }, reason }], snapshot)

    expect(planned?.result).toMatchObject({ action: 'create', feedTitle: 'ECDC', status: 'ok' })
    expect(planned?.write).toEqual({
      kind: 'create',
      data: { title: 'ECDC', rssUrl: 'https://www.ecdc.europa.eu/feed', issueId: HEALTH, language: 'en', crawlIntervalHours: 24, contentSource: 'rss' },
    })
  })

  it('reports a malformed change beside the others, naming the field', () => {
    const planned = planChangeset(
      [
        { action: 'update', match: { title: 'SIPRI' }, set: { region: 'europe' }, reason: 'Wrong region' },
        { action: 'rename', reason },
        'not an object',
        { action: 'delete', match: { title: 'Never crawled' }, reason },
      ],
      snapshot,
    )

    expect(planned[0]?.result).toMatchObject({
      index: 0,
      action: 'update',
      reason: 'Wrong region',
      status: 'error',
      message: expect.stringContaining('set.region'),
    })
    expect(planned[1]?.result).toMatchObject({ action: null, status: 'error' })
    expect(planned[2]?.result).toMatchObject({ action: null, reason: null, status: 'error' })
    expect(planned[3]?.result.status).toBe('ok')
    expect(countResults(planned.map(p => p.result))).toEqual({ ok: 1, noop: 0, error: 3 })
  })
})

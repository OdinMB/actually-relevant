import { describe, it, expect } from 'vitest'
import { feedChangeSchema, feedChangesetSchema, MAX_FEED_CHANGES } from './feedChangeset.js'

const update = { action: 'update', match: { title: 'SIPRI' }, set: { rssUrl: 'https://www.sipri.org/rss/combined.xml' }, reason: 'Feed moved' }
const remove = { action: 'delete', match: { rssUrl: 'https://www.thelancet.com/rssfeed/lancet_current.xml' }, reason: 'TDM reservation' }
const create = {
  action: 'create',
  feed: {
    title: 'ECDC',
    rssUrl: 'https://www.ecdc.europa.eu/en/taxonomy/term/1307/feed',
    url: 'https://www.ecdc.europa.eu/',
    issue: 'pandemics',
    language: 'en',
    region: 'western_europe',
    contentSource: 'page',
  },
  reason: 'Pandemics gap',
}

function changeset(changes: unknown[], extra: Record<string, unknown> = {}) {
  return { format: 'actually-relevant/feed-changeset', version: 1, title: 'Fixes', createdAt: '2026-11-01', changes, ...extra }
}

describe('feedChangesetSchema (the file around the changes)', () => {
  it('accepts a well-formed file', () => {
    expect(feedChangesetSchema.safeParse(changeset([update, remove, create])).success).toBe(true)
  })

  it.each([
    ['another format', changeset([update], { format: 'something-else' })],
    ['another version', changeset([update], { version: 2 })],
    ['no changes', changeset([])],
    ['too many changes', changeset(Array.from({ length: MAX_FEED_CHANGES + 1 }, () => update))],
    ['an unknown top-level field', changeset([update], { author: 'agent' })],
    ['changes that are not a list', { ...changeset([]), changes: { 0: update } }],
  ])('refuses %s', (_label, file) => {
    expect(feedChangesetSchema.safeParse(file).success).toBe(false)
  })
})

describe('feedChangeSchema (one change)', () => {
  it.each([
    ['an update', update],
    ['a delete', remove],
    ['a create', create],
    [
      'an update matched by id that renames and moves issue',
      { ...update, match: { id: '00000000-0000-0000-0000-000000000001' }, set: { title: 'New', issue: 'climate' } },
    ],
  ])('accepts %s', (_label, change) => {
    expect(feedChangeSchema.safeParse(change).success).toBe(true)
  })

  it('fills the create defaults of the feed form', () => {
    const parsed = feedChangeSchema.parse({ ...create, feed: { title: 'X', rssUrl: 'https://x.example/feed', issue: 'climate' } })

    expect(parsed.action === 'create' && parsed.feed).toMatchObject({ language: 'en', crawlIntervalHours: 24 })
  })

  it.each([
    ['an unknown action', { ...update, action: 'rename' }],
    ['a match naming two keys', { ...update, match: { title: 'SIPRI', rssUrl: 'https://www.sipri.org/rss' } }],
    ['an empty match', { ...update, match: {} }],
    ['a match on another field', { ...update, match: { url: 'https://www.sipri.org/' } }],
    ['a missing reason', { action: update.action, match: update.match, set: update.set }],
    ['a blank reason', { ...update, reason: '   ' }],
    ['a reason over 500 characters', { ...update, reason: 'x'.repeat(501) }],
    ['an empty set', { ...update, set: {} }],
    ['a database issue id instead of a slug', { ...update, set: { issueId: '00000000-0000-0000-0000-000000000001' } }],
    ['an unknown field in set', { ...update, set: { rssURL: 'https://x.example/feed' } }],
    ['an unknown content source', { ...update, set: { contentSource: 'api' } }],
    ['a title marker that backtracks', { ...update, set: { paywallTitleMarker: '(\\w+\\s?)+' } }],
    ['a create without an issue', { ...create, feed: { title: 'X', rssUrl: 'https://x.example/feed' } }],
    ['a create with an unknown region', { ...create, feed: { ...create.feed, region: 'europe' } }],
    ['a create with an invalid URL', { ...create, feed: { ...create.feed, rssUrl: 'not a url' } }],
    ['a delete that also sets fields', { ...remove, set: { active: false } }],
  ])('refuses %s', (_label, change) => {
    expect(feedChangeSchema.safeParse(change).success).toBe(false)
  })
})

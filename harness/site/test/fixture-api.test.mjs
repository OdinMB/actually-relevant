import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildFixtures } from '../lib/fixtures.mjs'
import { corsHeaders, createApiState, handleApiRequest, silentWav, specMatches, startFixtureServer } from '../lib/fixture-api.mjs'

const apiOrigin = 'http://127.0.0.1:40002'
const now = new Date('2026-10-26T12:00:00Z')

function api(options = {}) {
  return createApiState({ fixtures: buildFixtures(now, apiOrigin), apiOrigin, ...options })
}

function get(state, pathAndQuery) {
  const url = new URL(pathAndQuery, apiOrigin)
  const answer = handleApiRequest(state, { method: 'GET', path: url.pathname, query: url.searchParams, body: undefined })
  return { ...answer, json: answer.contentType?.startsWith('application/json') ? JSON.parse(answer.body) : undefined }
}

function post(state, path, body) {
  const answer = handleApiRequest(state, { method: 'POST', path, query: new URLSearchParams(), body })
  return { ...answer, json: JSON.parse(answer.body) }
}

test('the homepage has the four issues, each with its emotion buckets', () => {
  const { status, json } = get(api(), '/api/homepage')
  assert.equal(status, 200)
  assert.deepEqual(
    json.issues.map(i => i.slug),
    ['human-development', 'planet-climate', 'existential-threats', 'science-technology'],
  )
  for (const slug of Object.keys(json.storiesByIssue)) {
    const { uplifting, calm, negative } = json.storiesByIssue[slug]
    assert.ok(uplifting.length > 0 && calm.length > 0 && negative.length > 0, slug)
    assert.ok(uplifting.every(s => s.emotionTag === 'uplifting'))
    assert.ok(negative.every(s => s.emotionTag === 'frustrating' || s.emotionTag === 'scary'))
  }
})

test('stories filter by issue, child issue, emotion and search, newest first, paginated', () => {
  const state = api()
  const all = get(state, '/api/stories?pageSize=100').json
  assert.equal(all.total, 20)
  const dates = all.data.map(s => s.datePublished)
  assert.deepEqual(dates, [...dates].sort().reverse())
  assert.ok(all.data.every(s => s.aiGenerated.fields.includes('summary')))

  const issue = get(state, '/api/stories?issueSlug=planet-climate&pageSize=12').json
  assert.equal(issue.total, 5)
  const child = get(state, '/api/stories?issueSlug=energy').json
  assert.ok(child.total > 0 && child.data.every(s => s.issue.slug === 'energy'))
  const calm = get(state, '/api/stories?emotionTags=uplifting,calm').json
  assert.ok(calm.data.every(s => s.emotionTag === 'uplifting' || s.emotionTag === 'calm'))
  assert.equal(get(state, '/api/stories?search=MANGROVES').json.total, 1)
  assert.equal(get(state, '/api/stories?search=nothing-matches-this').json.total, 0)

  const page2 = get(state, '/api/stories?page=2&pageSize=12').json
  assert.equal(page2.page, 2)
  assert.equal(page2.data.length, 8)
  assert.equal(page2.totalPages, 2)
  assert.equal(get(state, '/api/stories?page=0').status, 400)
})

test('one story, its related stories and its cluster; unknown slugs answer as the server does', () => {
  const state = api()
  const [newest, other] = get(state, '/api/stories').json.data
  assert.equal(get(state, `/api/stories/${newest.slug}`).json.id, newest.id)
  const missing = get(state, '/api/stories/no-such-story')
  assert.equal(missing.status, 404)
  assert.deepEqual(missing.json, { error: 'Story not found' })
  const related = get(state, `/api/stories/${newest.slug}/related?limit=2`).json
  assert.ok(related.length <= 2 && related.every(s => s.slug !== newest.slug))
  assert.equal(get(state, `/api/stories/${newest.slug}/cluster`).json.sources.length, 2)
  assert.deepEqual(get(state, `/api/stories/${other.slug}/cluster`).json, { sources: [] })
})

test('issues, child issues and sources', () => {
  const state = api()
  assert.equal(get(state, '/api/issues').json.length, 4)
  const top = get(state, '/api/issues/human-development').json
  assert.equal(top.parent, null)
  assert.equal(top.children.length, 2)
  const child = get(state, '/api/issues/education').json
  assert.equal(child.parent.slug, 'human-development')
  assert.equal(get(state, '/api/issues/unknown').status, 404)
  const sources = get(state, '/api/sources').json
  assert.equal(sources.totalCount, 8)
  assert.ok(Object.keys(sources.byIssue).includes('Planet & Climate'))
})

test('the newsletter archive and issues, with the approved AI label', () => {
  const state = api()
  const archive = get(state, '/api/newsletters?page=1').json
  assert.equal(archive.total, 3)
  const issue = get(state, `/api/newsletters/${archive.data[0].slug}`).json
  assert.equal(issue.aiLabel.lead, 'AI-generated:')
  for (const story of issue.stories) assert.ok(issue.content.includes(`## ${story.headline}\n`), story.headline)
  assert.deepEqual(get(state, '/api/newsletters/fixture-issue-99').json, { error: 'Issue not found' })
  assert.ok(get(state, '/api/newsletters/feed.xml').body.startsWith('<?xml'))
})

test('the podcast, its episodes with transcripts, and media served by the fixture API', () => {
  const state = api()
  const podcast = get(state, '/api/podcast').json
  assert.equal(podcast.episodes.length, 3)
  assert.ok(podcast.episodes.every(e => e.audioUrl.startsWith(`${apiOrigin}/fixture-media/`) && !('transcript' in e)))
  assert.ok(podcast.show.feedUrl.startsWith(apiOrigin))
  const episode = get(state, `/api/podcast/episodes/${podcast.episodes[0].id}`).json
  assert.ok(episode.transcript.length > 2)
  assert.deepEqual(get(state, '/api/podcast/episodes/nope').json, { error: 'Episode not found' })
  const audio = get(state, new URL(podcast.episodes[0].audioUrl).pathname)
  assert.equal(audio.contentType, 'audio/wav')
  assert.equal(audio.body.length, podcast.episodes[0].audioBytes)
  assert.equal(silentWav().subarray(0, 4).toString('ascii'), 'RIFF')
  assert.equal(get(state, '/fixture-media/artwork.svg').contentType, 'image/svg+xml')
})

test('the signup answers as the server does, gates included', () => {
  const state = api()
  const { token } = get(state, '/api/subscribe/token').json
  assert.match(token, /^fixture-subscribe-token-/)
  const ok = post(state, '/api/subscribe', { email: 'reader@example.com', formToken: token })
  assert.deepEqual(ok.json, { success: true, message: 'Check your email to confirm your subscription.' })
  assert.equal(state.signups, 1)
  assert.equal(post(state, '/api/subscribe', { email: 'not-an-address', formToken: token }).status, 400)
  assert.equal(post(state, '/api/subscribe', { email: 'bot@example.com', formToken: token, website: 'x' }).json.success, true)
  assert.equal(post(state, '/api/subscribe', { email: 'bot@example.com' }).json.success, true)
  assert.equal(state.signups, 1, 'the honeypot and a missing form token are accepted silently')
  assert.deepEqual(post(state, '/api/subscribe/confirm', { token: 't', email: 'reader@example.com' }).json, { success: true })
})

test('feedback answers as the server does, without storing anything', () => {
  const state = api()
  const { token } = get(state, '/api/feedback/token').json
  const story = state.fixtures.stories[0]
  assert.deepEqual(post(state, '/api/feedback', { category: 'general', message: 'Hello', formToken: token }).json, { success: true })
  assert.deepEqual(post(state, '/api/feedback', { category: 'correction', message: 'Typo', storyId: story.id, formToken: token }).json, { success: true })
  assert.equal(post(state, '/api/feedback', { category: 'correction', message: 'Typo', storyId: 'nope', formToken: token }).status, 400)
  assert.equal(post(state, '/api/feedback', { category: 'rant', message: 'x', formToken: token }).status, 400)
  assert.equal(post(state, '/api/feedback', { category: 'bug', message: '', formToken: token }).status, 400)
  assert.equal(state.feedback, 2)
})

test('unknown routes answer 404 and are marked unhandled', () => {
  const state = api()
  const answer = get(state, '/api/admin/stories')
  assert.equal(answer.status, 404)
  assert.equal(answer.handled, false)
  assert.equal(get(state, '/api/homepage').handled, true)
  assert.equal(post(state, '/api/auth/refresh', undefined).status, 401)
})

test('--fail and --delay apply to matching paths only', () => {
  const state = api({
    failures: [
      { path: '/api/homepage', status: 500 },
      { path: '/api/subscribe/token', status: 503, code: 'SIGNUPS_PAUSED' },
      { path: '/api/stories/*', status: 'drop' },
    ],
    delays: [{ path: '/api/issues*', ms: 1500 }],
  })
  const home = get(state, '/api/homepage')
  assert.equal(home.status, 500)
  assert.equal(home.injected, true)
  assert.deepEqual(get(state, '/api/subscribe/token').json, { error: 'Fixture failure (503)', code: 'SIGNUPS_PAUSED' })
  assert.equal(get(state, '/api/stories/some-slug').drop, true)
  assert.equal(get(state, '/api/stories').status, 200, 'the prefix needs the slash')
  assert.equal(get(state, '/api/issues/education').delayMs, 1500)
  assert.equal(get(state, '/api/sources').delayMs, 0)
  assert.equal(specMatches('/api/stories/*', '/api/stories/x/related'), true)
  assert.equal(specMatches('/api/stories', '/api/stories/x'), false)
})

test('CORS lets in only the site server', () => {
  const site = 'http://127.0.0.1:40003'
  assert.equal(corsHeaders(site, [site])['Access-Control-Allow-Origin'], site)
  assert.deepEqual(corsHeaders('https://example.com', [site]), {})
  assert.deepEqual(corsHeaders(undefined, [site]), {})
})

test('the fixture server listens on 127.0.0.1, answers 503 until its fixtures are in, and logs no bodies', async t => {
  const state = createApiState({ fixtures: null, apiOrigin: null })
  const log = []
  const site = 'http://127.0.0.1:40003'
  const server = await startFixtureServer({ state, allowedOrigins: () => [site], log })
  t.after(() => server.close())
  const origin = `http://127.0.0.1:${server.port}`
  assert.equal((await fetch(`${origin}/api/homepage`)).status, 503)
  state.apiOrigin = origin
  state.fixtures = buildFixtures(now, origin)
  const home = await fetch(`${origin}/api/homepage`, { headers: { Origin: site } })
  assert.equal(home.status, 200)
  assert.equal(home.headers.get('access-control-allow-origin'), site)
  assert.equal((await home.json()).issues.length, 4)
  const signup = await fetch(`${origin}/api/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'reader@example.com' }),
  })
  assert.equal(signup.status, 200)
  assert.deepEqual(log, [
    { method: 'GET', path: '/api/homepage', status: 200, handled: true, injected: false },
    { method: 'POST', path: '/api/subscribe', status: 200, handled: true, injected: false },
  ])
  assert.ok(!JSON.stringify(log).includes('reader@example.com'), 'no request body is kept')
})

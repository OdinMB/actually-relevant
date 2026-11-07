import { it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { PodcastEdition } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { describeDb, useTestDatabase } from '../test/db/harness.js'
import { findOrCreateWeekEpisode } from './podcastWeekly.js'
import { alertMissedWeek } from './podcastMissedWeek.js'
import { getPublishedEpisodes, listPublishedEpisodeDates } from './podcastPublish.js'

// Saturday 07:00 in Berlin (CEST): ISO week 2026-W42.
const SATURDAY = new Date('2026-10-17T05:00:00Z')

const publishedEpisode = (edition: PodcastEdition, weekKey: string) =>
  prisma.podcast.create({
    data: {
      title: `${edition} ${weekKey}`,
      edition,
      weekKey,
      status: 'published',
      stage: 'ready',
      publishedAt: new Date('2026-10-10T07:00:00Z'),
      audioUrl: `https://audio.example/${edition}.mp3`,
      audioBytes: 5_000_000,
    },
  })

const notices = () => prisma.adminNotice.findMany({ orderBy: { title: 'asc' }, select: { severity: true, title: true, dedupeKey: true } })

describeDb("the podcast's two shows (PostgreSQL)", () => {
  useTestDatabase()
  // The alerts below are recorded as admin notices; none may reach a webhook from a test run.
  beforeAll(() => {
    vi.stubEnv('WEBHOOK_URL', '')
  })
  afterAll(() => {
    vi.unstubAllEnvs()
  })

  it('holds one weekly episode per show for the same week, and refuses a second one of the same show', async () => {
    const full = await findOrCreateWeekEpisode(SATURDAY, 'full')
    const uplifting = await findOrCreateWeekEpisode(SATURDAY, 'uplifting')
    expect(full.id).not.toBe(uplifting.id)
    expect([full, uplifting].map(e => [e.edition, e.weekKey])).toEqual([
      ['full', '2026-W42'],
      ['uplifting', '2026-W42'],
    ])
    expect((await findOrCreateWeekEpisode(SATURDAY, 'uplifting')).id).toBe(uplifting.id)
    await expect(prisma.podcast.create({ data: { title: 'twin', weekKey: '2026-W42', edition: 'uplifting' } })).rejects.toMatchObject({ code: 'P2002' })
  })

  it('keeps standalone episodes on the main show (the CHECK)', async () => {
    await expect(prisma.podcast.create({ data: { title: 'standalone', kind: 'standalone', edition: 'uplifting' } })).rejects.toThrow(
      /podcasts_standalone_full_edition/,
    )
    await expect(prisma.podcast.create({ data: { title: 'standalone', kind: 'standalone' } })).resolves.toMatchObject({ edition: 'full' })
  })

  it('claims the missed-week alert once per show and week', async () => {
    await prisma.podcast.create({
      data: {
        title: 'blocked',
        weekKey: '2026-W42',
        edition: 'uplifting',
        mode: 'automated',
        stage: 'selected',
        blockedAt: SATURDAY,
        blockedReason: 'cap reached',
      },
    })
    for (let run = 0; run < 2; run++) {
      await alertMissedWeek(SATURDAY, 'full')
      await alertMissedWeek(SATURDAY, 'uplifting')
    }
    const claims = await prisma.podcastMissedWeekAlert.findMany({ orderBy: { edition: 'asc' } })
    expect(claims.map(c => [c.edition, c.weekKey])).toEqual([
      ['full', '2026-W42'],
      ['uplifting', '2026-W42'],
    ])
    expect(claims[1]!.reason).toMatch(/blocked: cap reached/)
    expect((await notices()).map(n => [n.severity, n.title])).toEqual([
      ['warning', 'No Actually Uplifting episode ready to publish this Saturday'],
      ['warning', 'No podcast episode ready to publish this Saturday'],
    ])
  })

  it("records Actually Uplifting's short week as one info notice, with no claim", async () => {
    await alertMissedWeek(SATURDAY, 'uplifting')
    await alertMissedWeek(SATURDAY, 'uplifting')
    expect(await prisma.podcastMissedWeekAlert.count()).toBe(0)
    expect(await notices()).toEqual([
      { severity: 'info', title: 'No Actually Uplifting episode this week', dedupeKey: 'podcast-uplifting-no-stories:2026-W42' },
    ])
  })

  it('lists no Actually Uplifting episode on any public read while the show is closed', async () => {
    const full = await publishedEpisode('full', '2026-W41')
    await publishedEpisode('uplifting', '2026-W41')
    expect((await getPublishedEpisodes('full')).map(e => e.id)).toEqual([full.id])
    expect(await getPublishedEpisodes('uplifting')).toEqual([])
    expect((await listPublishedEpisodeDates()).map(e => e.id)).toEqual([full.id])
  })
})

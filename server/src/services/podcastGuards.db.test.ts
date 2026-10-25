import { it, expect, describe } from 'vitest'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { describeDb, useTestDatabase } from '../test/db/harness.js'
import { assertJobEnabled, episodeTtsChars, monthToDateChars, PodcastBlockedError, PodcastStoppedError, reserveTtsChars } from './podcastGuards.js'

const CAP = config.podcast.monthlyTtsCharCap

const createPodcast = (title = 'Episode') => prisma.podcast.create({ data: { title } })

async function usage(chars: number, data: { podcastId?: string | null; createdAt?: Date } = {}) {
  await prisma.podcastTtsUsage.create({ data: { chars, podcastId: data.podcastId ?? null, createdAt: data.createdAt ?? new Date() } })
}

const totalReserved = async () => (await prisma.podcastTtsUsage.aggregate({ _sum: { chars: true } }))._sum.chars ?? 0

describeDb('podcast guards (PostgreSQL)', () => {
  useTestDatabase()

  describe('reserveTtsChars', () => {
    it('records the reservation when it stays under the cap', async () => {
      const pod = await createPodcast()
      await reserveTtsChars(pod.id, 1500)
      const rows = await prisma.podcastTtsUsage.findMany()
      expect(rows).toEqual([expect.objectContaining({ podcastId: pod.id, chars: 1500 })])
    })

    it('refuses a reservation that would pass the cap, as a block, and records nothing', async () => {
      const pod = await createPodcast()
      await usage(CAP - 1000)
      await expect(reserveTtsChars(pod.id, 1500)).rejects.toBeInstanceOf(PodcastBlockedError)
      expect(await prisma.podcastTtsUsage.count()).toBe(1)
    })

    it('counts usage of deleted episodes (no podcast id)', async () => {
      const pod = await createPodcast()
      await usage(CAP)
      await expect(reserveTtsChars(pod.id, 1)).rejects.toBeInstanceOf(PodcastBlockedError)
    })

    it("ignores last month's usage", async () => {
      const pod = await createPodcast()
      const now = new Date('2026-10-15T12:00:00Z')
      await usage(CAP, { createdAt: new Date('2026-09-30T23:59:59Z') })
      await reserveTtsChars(pod.id, 1000, now)
      expect(await monthToDateChars(now)).toBe(1000)
    })

    it('lets only one of several concurrent reservations near the cap through (the advisory lock)', async () => {
      const pods = await Promise.all([createPodcast('a'), createPodcast('b'), createPodcast('c'), createPodcast('d')])
      await usage(CAP - 1500)
      const results = await Promise.allSettled(pods.map(p => reserveTtsChars(p.id, 1000)))
      expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
      for (const r of results) if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(PodcastBlockedError)
      expect(await totalReserved()).toBe(CAP - 500)
    })
  })

  it("monthToDateChars counts only this UTC month's usage, deleted episodes included", async () => {
    const pod = await createPodcast()
    await usage(900, { podcastId: pod.id, createdAt: new Date('2026-09-30T23:59:59Z') })
    await usage(400, { podcastId: pod.id, createdAt: new Date('2026-10-01T00:00:00Z') })
    await usage(50, { createdAt: new Date('2026-10-10T00:00:00Z') })
    expect(await monthToDateChars(new Date('2026-10-15T12:00:00Z'))).toBe(450)
    expect(await monthToDateChars(new Date('2026-08-15T12:00:00Z'))).toBe(1350)
  })

  it("episodeTtsChars sums one episode's reservations across months", async () => {
    const [pod, other] = await Promise.all([createPodcast('a'), createPodcast('b')])
    await usage(900, { podcastId: pod.id, createdAt: new Date('2026-09-30T23:59:59Z') })
    await usage(400, { podcastId: pod.id })
    await usage(7, { podcastId: other.id })
    expect(await episodeTtsChars(pod.id)).toBe(1300)
    expect(await episodeTtsChars('no-such-episode')).toBe(0)
  })

  describe('assertJobEnabled', () => {
    it('passes for an enabled row', async () => {
      await prisma.jobRun.create({ data: { jobName: 'generate_podcast', cronExpression: '0 6 * * 5' } })
      await expect(assertJobEnabled('generate_podcast')).resolves.toBeUndefined()
    })

    it('stops for a disabled or missing row', async () => {
      await prisma.jobRun.create({ data: { jobName: 'generate_podcast', cronExpression: '0 6 * * 5', enabled: false } })
      await expect(assertJobEnabled('generate_podcast')).rejects.toBeInstanceOf(PodcastStoppedError)
      await expect(assertJobEnabled('publish_podcast')).rejects.toBeInstanceOf(PodcastStoppedError)
    })
  })
})

import { describe, it, expect } from 'vitest'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { describeDb, useTestDatabase } from '../test/db/harness.js'
import { BadRequestError } from '../utils/errors.js'
import { checkSpendWarnings, getSpendingOverview, setSpendWarning, type SpendingRow } from './spending.js'

const NOW = new Date('2026-11-16T12:00:00Z')
const monthStart = (yyyyMm: string) => new Date(`${yyyyMm}-01T00:00:00Z`)

async function spent(jobName: string, yyyyMm: string, costUsd: number, searchUsd = 0) {
  await prisma.jobMonthSpend.create({ data: { jobName, month: monthStart(yyyyMm), costUsd, standardCostUsd: costUsd, searchUsd, runs: 1 } })
}

async function researchRun(trigger: 'editor' | 'pipeline', startedAt: string, costUsd: number, tavilyCredits = 0) {
  await prisma.storyResearchRun.create({
    data: { status: 'completed', trigger, costUsd, tavilyCredits, startedAt: new Date(startedAt), finishedAt: new Date(startedAt) },
  })
}

const rows = (overview: Awaited<ReturnType<typeof getSpendingOverview>>) => overview.groups.flatMap(g => g.rows)
const rowOf = (overview: Awaited<ReturnType<typeof getSpendingOverview>>, scope: string): SpendingRow => {
  const row = rows(overview).find(r => r.scope === scope)
  if (!row) throw new Error(`no row for ${scope}`)
  return row
}

describeDb('spending (PostgreSQL)', () => {
  useTestDatabase()

  describe('getSpendingOverview', () => {
    it("sums each job's month, AI as its cost less its searches, with the two months before and the pace", async () => {
      await spent('research_stories', '2026-11', 14.2, 8.6)
      await spent('research_stories', '2026-10', 22.4, 10)
      await spent('research_stories', '2026-09', 21)
      await spent('research_stories', '2026-08', 99)
      await setSpendWarning('research_stories', 25)

      const overview = await getSpendingOverview(NOW)

      expect(overview).toMatchObject({ month: '2026-11', previousMonths: ['2026-10', '2026-09'], day: 16, daysInMonth: 30 })
      expect(rowOf(overview, 'research_stories')).toEqual({
        scope: 'research_stories',
        thisMonth: { aiUsd: expect.closeTo(5.6, 6), searchUsd: expect.closeTo(8.6, 6), totalUsd: expect.closeTo(14.2, 6) },
        paceUsd: expect.closeTo((14.2 * 30) / 16, 6),
        previousUsd: [expect.closeTo(22.4, 6), expect.closeTo(21, 6)],
        levelUsd: 25,
        warning: 'on_pace',
      })
    })

    it('groups the rows as the Jobs page groups jobs: each chain with its steps in order, then the rest', async () => {
      await spent('publish_stories', '2026-11', 0.05)

      const overview = await getSpendingOverview(NOW)

      const daily = overview.groups.find(g => g.chain === 'daily_edition_chain')
      expect(daily?.rows.map(r => r.scope)).toEqual(['select_stories', 'research_stories', 'build_story_context', 'publish_stories'])
      expect(overview.groups.map(g => g.chain)).toEqual(['intake_chain', 'daily_edition_chain', 'newsletter_chain', 'podcast_chain', null])
      expect(overview.groups.at(-1)?.rows.map(r => r.scope)).toEqual(['editor_research', 'social_auto_post'])
      // A job that uses models is listed though it spent nothing; one that does not, only once it has spent
      expect(rowOf(overview, 'preassess_stories')).toMatchObject({ thisMonth: { totalUsd: 0 }, previousUsd: [0, 0], levelUsd: null, warning: null })
      expect(rows(overview).some(r => r.scope === 'crawl_feeds' || r.scope === 'bluesky_update_metrics')).toBe(false)
      // A chain is never a row of its own: its steps carry its spend
      expect(rows(overview).some(r => r.scope.endsWith('_chain'))).toBe(false)
    })

    it("counts research an editor started from its own runs, and the research step's runs only in its job's spend", async () => {
      await researchRun('editor', '2026-11-03T10:00:00Z', 0.5, 25)
      await researchRun('editor', '2026-10-20T10:00:00Z', 0.3, 10)
      await researchRun('pipeline', '2026-11-03T10:00:00Z', 0.25, 20)
      await spent('research_stories', '2026-11', 2)

      const overview = await getSpendingOverview(NOW)

      const search = 25 * config.research.tavilyUsdPerCredit
      expect(rowOf(overview, 'editor_research')).toMatchObject({
        thisMonth: { aiUsd: expect.closeTo(0.5 - search, 6), searchUsd: expect.closeTo(search, 6), totalUsd: expect.closeTo(0.5, 6) },
        previousUsd: [expect.closeTo(0.3, 6), 0],
      })
      expect(overview.total).toMatchObject({ scope: 'all', thisMonth: { totalUsd: expect.closeTo(2.5, 6) }, previousUsd: [expect.closeTo(0.3, 6), 0] })
    })

    it("totals every row with the total's level, and gives the podcast's voice characters this month against its cap", async () => {
      await spent('assess_stories', '2026-11', 40)
      await spent('generate_podcast', '2026-11', 25, 0)
      await setSpendWarning('all', 60)
      await prisma.podcastTtsUsage.create({ data: { chars: 18_400, createdAt: new Date('2026-11-06T08:00:00Z') } })
      await prisma.podcastTtsUsage.create({ data: { chars: 9_000, createdAt: new Date('2026-10-30T08:00:00Z') } })

      const overview = await getSpendingOverview(NOW)

      expect(overview.total).toMatchObject({ thisMonth: { totalUsd: expect.closeTo(65, 6) }, levelUsd: 60, warning: 'passed' })
      expect(overview.voices).toEqual({ usedChars: 18_400, capChars: config.podcast.monthlyTtsCharCap })
    })
  })

  describe('setSpendWarning', () => {
    it('sets, changes and clears a level', async () => {
      await setSpendWarning('research_stories', 25)
      await setSpendWarning('research_stories', 30)
      await setSpendWarning('all', 60)
      await setSpendWarning('editor_research', 5)
      expect(await prisma.spendWarning.findMany({ orderBy: { scope: 'asc' } })).toEqual([
        { scope: 'all', levelUsd: 60 },
        { scope: 'editor_research', levelUsd: 5 },
        { scope: 'research_stories', levelUsd: 30 },
      ])

      await setSpendWarning('research_stories', null)
      await setSpendWarning('generate_podcast', null)
      expect((await prisma.spendWarning.findMany()).map(w => w.scope).sort()).toEqual(['all', 'editor_research'])
    })

    it('takes a job that has a row though it uses no models, and refuses a chain and a name that is no job', async () => {
      await prisma.jobRun.create({ data: { jobName: 'publish_stories', cronExpression: '0 * * * *' } })
      await setSpendWarning('publish_stories', 2)

      for (const scope of ['daily_edition_chain', 'no_such_job']) await expect(setSpendWarning(scope, 5)).rejects.toBeInstanceOf(BadRequestError)
      expect(await prisma.spendWarning.count()).toBe(1)
    })
  })

  describe('checkSpendWarnings', () => {
    const notices = () => prisma.adminNotice.findMany({ orderBy: { dedupeKey: 'asc' } })

    it("records one notice per scope and month for the job's level and the total's, and nothing more on a second pass", async () => {
      await setSpendWarning('research_stories', 25)
      await setSpendWarning('all', 10)
      await setSpendWarning('assess_stories', 1)
      await spent('research_stories', '2026-11', 26, 9)
      await spent('assess_stories', '2026-11', 3)

      await checkSpendWarnings('research_stories', NOW)
      await checkSpendWarnings('research_stories', NOW)

      const recorded = await notices()
      expect(recorded.map(n => [n.dedupeKey, n.count])).toEqual([
        ['spend-warn:all:2026-11:passed', 1],
        ['spend-warn:research_stories:2026-11:passed', 1],
      ])
      expect(recorded[1]).toMatchObject({ source: 'jobs', severity: 'warning', link: '/admin/spending', title: 'Research Stories passed $25 this month' })
      expect(recorded[1]!.message).toMatch(/\$26\.00 since Nov 1 \(AI \$17\.00, web search \$9\.00\)/)
      expect(recorded[0]!.title).toBe('Spending passed $10 this month')
    })

    it('records a scope heading past its level at this pace, and again in the next month', async () => {
      await setSpendWarning('research_stories', 25)
      await spent('research_stories', '2026-11', 14.2, 8.6)
      await spent('research_stories', '2026-12', 20)

      await checkSpendWarnings('research_stories', NOW)
      await checkSpendWarnings('research_stories', new Date('2026-12-20T12:00:00Z'))

      const recorded = await notices()
      expect(recorded.map(n => n.dedupeKey)).toEqual(['spend-warn:research_stories:2026-11:pace', 'spend-warn:research_stories:2026-12:pace'])
      expect(recorded[0]!.title).toBe('Research Stories is on pace to pass $25 this month')
    })

    it('records the passed notice after the pace notice in the same month, each once', async () => {
      await setSpendWarning('research_stories', 25)
      await spent('research_stories', '2026-11', 14.2)
      await checkSpendWarnings('research_stories', NOW)

      await prisma.jobMonthSpend.update({ where: { jobName_month: { jobName: 'research_stories', month: monthStart('2026-11') } }, data: { costUsd: 26.2 } })
      await checkSpendWarnings('research_stories', NOW)
      await checkSpendWarnings('research_stories', NOW)

      expect((await notices()).map(n => [n.dedupeKey, n.count, n.title])).toEqual([
        ['spend-warn:research_stories:2026-11:pace', 1, 'Research Stories is on pace to pass $25 this month'],
        ['spend-warn:research_stories:2026-11:passed', 1, 'Research Stories passed $25 this month'],
      ])
    })

    it("checks research an editor started against its own level and the total's", async () => {
      await setSpendWarning('editor_research', 1)
      await researchRun('editor', '2026-11-10T10:00:00Z', 1.5)

      await checkSpendWarnings('editor_research', NOW)

      expect((await notices()).map(n => [n.dedupeKey, n.title])).toEqual([
        ['spend-warn:editor_research:2026-11:passed', 'Research started by an editor passed $1 this month'],
      ])
    })

    it('records nothing without a level, under a level, or for a job whose level is not passed', async () => {
      await spent('assess_stories', '2026-11', 80)
      await setSpendWarning('research_stories', 25)
      await spent('research_stories', '2026-11', 1)

      await checkSpendWarnings('assess_stories', NOW)
      await checkSpendWarnings('research_stories', NOW)

      expect(await notices()).toEqual([])
    })
  })
})

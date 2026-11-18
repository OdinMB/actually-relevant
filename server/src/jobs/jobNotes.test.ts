import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../lib/prisma.js', () => ({ default: {} }))

const { jobNotes, failureShareWarning } = await import('./jobNotes.js')
const { emptyUsage } = await import('../lib/runUsage.js')
const { JOB_HANDLERS } = await import('./handlers.js')
const { config } = await import('../config.js')

const JOBS = Object.keys(JOB_HANDLERS)

const originals: [object, Record<string, unknown>][] = []
/** Set config values for one test; `afterEach` puts them back. */
function override<T extends object>(target: T, values: Partial<T>) {
  originals.push([target, Object.fromEntries(Object.keys(values).map(key => [key, target[key as keyof T]]))])
  Object.assign(target, values)
}

const researchOn = () => vi.stubEnv('TAVILY_API_KEY', 'test-key')
const researchKeyUnset = () => vi.stubEnv('TAVILY_API_KEY', '')
const unpricedModel = () => {
  researchOn()
  for (const tier of Object.values(config.llm.models)) override(tier, { name: 'model-without-price' })
}

afterEach(() => {
  for (const [target, values] of originals.splice(0).reverse()) Object.assign(target, values)
  vi.unstubAllEnvs()
})

describe('jobNotes', () => {
  it('words every note and warning for the people who run the site: no setting, code or file names, at most one em dash', () => {
    const texts: string[] = []
    for (const state of [researchOn, researchKeyUnset, unpricedModel]) {
      state()
      for (const job of JOBS) {
        const { note, warning } = jobNotes(job)
        texts.push(...[note, warning].filter((t): t is string => t !== null))
      }
    }
    expect(texts.length).toBeGreaterThan(JOBS.length)
    for (const text of texts) {
      expect(text, text).not.toMatch(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/) // an environment variable
      expect(text, text).not.toMatch(/`|\w\(\)|\bconfig\.|\.(ts|js|md)\b/) // code, a function, a file
      expect(text.split('—').length - 1, text).toBeLessThanOrEqual(1)
    }
  })

  // Each value the note names comes from config at the call, never a copy of today's default
  it.each([
    ['research_stories', () => override(config.research.pipeline, { perRun: 37, concurrency: 29, maxWaitMinutes: 47 }), ['37', '29', '47']],
    ['research_stories', () => override(config.research, { monthlyCapUsd: 13 }), ['$13']],
    ['publish_stories', () => override(config.research.pipeline, { maxWaitMinutes: 47 }), ['47']],
    [
      'build_story_context',
      () => (
        override(config.storyContext, { lookbackDays: 4, maxSearches: 5, failedStoriesMin: 7 }),
        override(config.jobs.failureShare, { share: 0.3, minItems: 31 })
      ),
      ['4', '5', '30%', '31', '7'],
    ],
    ['research_pass', () => override(config.research.pass, { perRun: 37, concurrency: 29, failedStoriesMin: 7 }), ['37', '29', '7']],
    [
      'research_pass',
      () => (
        override(config.research, { monthlyCapUsd: 13 }),
        override(config.research.pipeline, { maxWaitMinutes: 47 }),
        override(config.jobs.failureShare, { share: 0.3, minItems: 31 })
      ),
      ['$13', '47', '30%', '31'],
    ],
    [
      'link_overviews',
      () => (
        override(config.overviews, { perRun: 37, backfillPerRun: 290, backfillDays: 47, concurrency: 29, failedStoriesMin: 7 }),
        override(config.jobs.failureShare, { share: 0.3, minItems: 31 })
      ),
      ['37', '290', '47', '29', '7', '30%', '31'],
    ],
    ['preassess_stories', () => override(config.preassess, { batchSize: 17 }), ['17']],
    ['assess_stories', () => (override(config.assess, { fullAssessmentThreshold: 9 }), override(config.dedup, { timeWindowDays: 23 })), ['9', '23']],
    ['select_stories', () => override(config.selection, { ratio: 0.3, relevanceMin: 6, maxGroupSize: 33 }), ['30%', '6', '33']],
    ['social_auto_post', () => override(config.socialAutoPost, { lookbackHours: 41 }), ['41']],
    ['bluesky_update_metrics', () => override(config.bluesky.metrics, { maxAgeDays: 43 }), ['43']],
    ['mastodon_update_metrics', () => override(config.mastodon.metrics, { maxAgeDays: 44 }), ['44']],
    ['generate_newsletter', () => override(config.content, { storyAssignmentDays: 11 }), ['11']],
    ['generate_uplifting_newsletter', () => override(config.content, { storyAssignmentDays: 11 }), ['11']],
    [
      'generate_podcast',
      () => override(config.podcast, { generateWindowEndHourUtc: 19, maxAttemptsPerWeek: 5, monthlyTtsCharCap: 81_000 }),
      ['19:00', '5', '81,000'],
    ],
    ['publish_podcast', () => override(config.podcast, { autoPublishMinAgeHours: 7, publishTimeZone: 'America/New_York' }), ['7', 'New York']],
    ['generate_uplifting_podcast', () => override(config.podcast, { minStories: 6 }), ['6']],
    ['poll_plunk_activity', () => override(config.plunk, { activityLookbackDays: 31 }), ['31']],
    ['send_queued_confirmations', () => override(config.subscribe, { globalHourlyMax: 53, confirmTokenExpiryHours: 26 }), ['53', '26']],
    ['cleanup_old_stories', () => override(config.storyRetention, { maxAgeMonths: 7 }), ['7']],
  ] as const)('names the config values of %s', (job, setConfig, values) => {
    researchOn()
    setConfig()
    const { note } = jobNotes(job)
    // The whole number: "6" is not the 6 in "16" or in "6,000"
    for (const value of values) expect(note).toMatch(new RegExp(`(?<!\\d,?)${value.replace(/[$.]/g, '\\$&')}(?!,?\\d)`))
  })

  it('leaves out the grouping of same-event stories from the assessment note while dedup is off', () => {
    researchOn()
    override(config.dedup, { timeWindowDays: 23 })
    expect(jobNotes('assess_stories').note).toContain('23')
    override(config.dedup, { enabled: false })
    expect(jobNotes('assess_stories').note).not.toContain('23')
  })

  it('names who the automatic newsletter goes to: everyone while the editions are closed, the full edition once they are open', () => {
    researchOn()
    override(config.plunk, { fullEditionSegmentId: '', upliftingSegmentId: '' })
    const closed = jobNotes('publish_newsletter').note
    override(config.plunk, { fullEditionSegmentId: 'seg-full', upliftingSegmentId: 'seg-up' })
    expect(jobNotes('publish_newsletter').note).not.toBe(closed)
  })

  describe('the research step', () => {
    it('warns of nothing while research is on, and explains the step in its note', () => {
      researchOn()
      expect(jobNotes('research_stories')).toEqual({ note: expect.any(String), warning: null })
    })

    it('warns while the key is unset, keeping the same note', () => {
      researchOn()
      const { note } = jobNotes('research_stories')
      researchKeyUnset()
      expect(jobNotes('research_stories')).toEqual({ note, warning: expect.stringMatching(/Tavily key/) })
    })

    it('warns while a model it uses has no price, naming the model', () => {
      unpricedModel()
      expect(jobNotes('research_stories').warning).toContain('model-without-price')
    })

    it('is the only job with a warning, whatever the research state', () => {
      for (const state of [researchOn, researchKeyUnset, unpricedModel]) {
        state()
        const warned = JOBS.filter(job => jobNotes(job).warning !== null)
        expect(warned).toEqual(state === researchOn ? [] : ['research_stories'])
      }
    })
  })

  it('says the research pass takes the place of the two old steps, and that it cannot be switched on while its evals are pending', () => {
    researchOn()
    const { note } = jobNotes('research_pass')
    expect(note).toMatch(/switches Research Stories and Build Story Context off/)
    expect(note).toMatch(/cannot be enabled until its quality checks/)
    expect(note).toMatch(/"Run now" does nothing while the job is disabled/)
  })

  it('has neither for a job it does not know', () => {
    expect(jobNotes('not_a_job')).toEqual({ note: null, warning: null })
  })

  describe('the failure share of the items a run checked', () => {
    const usage = (itemsChecked: number, itemsFailed: number) => ({ ...emptyUsage(), itemsChecked, itemsFailed })

    it('warns when more than the share failed, from the least number of checked items on', () => {
      override(config.jobs.failureShare, { share: 0.2, minItems: 20 })
      expect(failureShareWarning(usage(180, 41))).toMatch(/41 of 180 checked items/)
      expect(failureShareWarning(usage(20, 5))).toMatch(/5 of 20 checked items/)
    })

    it('stays quiet at exactly the share, under the least number of items, with none checked and without a run', () => {
      override(config.jobs.failureShare, { share: 0.2, minItems: 20 })
      expect(failureShareWarning(usage(20, 4))).toBeNull()
      expect(failureShareWarning(usage(19, 19))).toBeNull()
      expect(failureShareWarning(usage(0, 0))).toBeNull()
      expect(failureShareWarning(null)).toBeNull()
    })

    it('reads the share and the least number of items from config at each call', () => {
      override(config.jobs.failureShare, { share: 0.5, minItems: 10 })
      expect(failureShareWarning(usage(10, 5))).toBeNull()
      expect(failureShareWarning(usage(10, 6))).not.toBeNull()
    })

    it("is any job's warning, from the last run's usage, and words it for the people who run the site", () => {
      researchOn()
      const warning = jobNotes('select_stories', { lastRunUsage: usage(100, 60) }).warning
      expect(warning).toMatch(/60 of 100/)
      expect(warning).not.toMatch(/`|\w\(\)|\bconfig\./)
      expect(jobNotes('select_stories', { lastRunUsage: usage(100, 3) }).warning).toBeNull()
    })

    it("comes after a job's own warning", () => {
      researchKeyUnset()
      const warning = jobNotes('research_stories', { lastRunUsage: usage(100, 60) }).warning
      expect(warning).toMatch(/Tavily key.*60 of 100/s)
    })
  })
})

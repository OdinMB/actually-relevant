import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../lib/prisma.js', () => ({ default: {} }))

const { jobNotes } = await import('./jobNotes.js')
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

  it('has neither for a job it does not know', () => {
    expect(jobNotes('not_a_job')).toEqual({ note: null, warning: null })
  })
})

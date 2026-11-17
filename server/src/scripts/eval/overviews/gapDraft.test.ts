import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { contextInput, gapKey } from '../../../test/contextFixtures.js'
import { fakeEvalContext } from '../../../test/fakeEvalContext.js'
import type { ContextInput } from '../../../services/storyContextPipeline.js'
import {
  developmentSlugs,
  DRAFT_ARM,
  draftGapKeys,
  draftPrompt,
  FIGURE_HEAVY_MIN,
  runGapDraftStep,
  sampleGapStories,
  stratumOf,
  writeDrafts,
  type GapCandidate,
  type GapDraftStepOptions,
} from './gapDraft.js'
import type { KeyFile } from './keyFiles.js'
import type { AnswerKey } from './keySchema.js'
import type { GapDraftAnswer } from './prompts.js'

const candidate = (slug: string, issue = 'climate', figures = 0): GapCandidate => ({ id: `id-${slug}`, slug, issue, day: '2026-11-14', figures })

/** A draft that keeps every rule of the format: the fixture key's needs, every other slot not needed. */
const ANSWER: GapDraftAnswer = {
  needs: gapKey().needs,
  notNeeded: ['next', 'why_now', 'build_up'].map(slot => ({ slot: slot as 'next', why: 'w' })),
  notes: '',
}

describe('the sample', () => {
  it('calls a story figure-heavy from its third significant number, per top-level issue', () => {
    expect(stratumOf({ issue: 'climate', figures: FIGURE_HEAVY_MIN })).toBe('climate · figure-heavy')
    expect(stratumOf({ issue: 'none', figures: FIGURE_HEAVY_MIN - 1 })).toBe('none · figure-light')
  })

  it('names every story a development key lists, entries and near misses', () => {
    const file = (key: Partial<AnswerKey> | null): KeyFile => ({ file: 'k.json', key: key as AnswerKey | null, errors: [] })
    const slugs = developmentSlugs([
      file({ entries: [{ slug: 'a' }, { slug: 'b' }] as AnswerKey['entries'], nearMisses: [{ slug: 'x' }] as AnswerKey['nearMisses'] }),
      file(null),
    ])
    expect([...slugs].sort()).toEqual(['a', 'b', 'x'])
  })

  it('leaves out the development stories and spreads the rest over the strata', () => {
    const pool = [
      ...['h1', 'h2', 'h3'].map(s => candidate(s, 'health', 5)),
      ...['l1', 'l2', 'l3'].map(s => candidate(s, 'health', 0)),
      ...['c1', 'c2', 'c3'].map(s => candidate(s, 'climate', 0)),
    ]
    const { picked, shortfalls } = sampleGapStories(pool, new Set(['h1', 'h2']), 3)
    expect(picked.map(stratumOf).sort()).toEqual(['climate · figure-light', 'health · figure-heavy', 'health · figure-light'])
    expect(picked.map(p => p.slug)).toContain('h3')
    expect(shortfalls).toEqual([])
    expect(sampleGapStories(pool, new Set(), 3)).toEqual(sampleGapStories([...pool].reverse(), new Set(), 3))
  })

  it('reports a shortfall rather than padding', () => {
    expect(sampleGapStories([candidate('a')], new Set()).shortfalls).toEqual(['1 of 30 items available'])
  })
})

describe('drafting', () => {
  const story = (slug: string): { slug: string; input: ContextInput } => ({ slug, input: contextInput({ storyId: `id-${slug}` }) })

  it("shows the drafter the published story and research's fact statements", () => {
    const prompt = draftPrompt(contextInput())
    expect(prompt).toContain('<PARAGRAPH id="P1">Fires burned 2.88 million hectares.</PARAGRAPH>')
    expect(prompt).toContain('<POINT id="W1">Smoke reaches millions.</POINT>')
    expect(prompt).toContain('<FACT id="S0F1">Fires burned 2.88 million hectares.</FACT>')
    expect(prompt).toContain('<SLOT id="response">')
  })

  it("writes each answer as a key under the story's slug, title and day, with the format's errors", async () => {
    const ctx = fakeEvalContext(() => ANSWER)
    const [ok] = await draftGapKeys(ctx, [story('story-a')])
    expect(ok).toMatchObject({ slug: 'story-a', outcome: 'ok', errors: [] })
    expect(ok!.key).toMatchObject({ schemaVersion: 1, slug: 'story-a', title: 'Story A', date: '2026-11-14', needs: ANSWER.needs })
    expect(ctx.calls[0]).toMatchObject({ arm: DRAFT_ARM, schemaName: expect.stringMatching(/^overview-gap-draft#[0-9a-f]{8}$/) })

    const [loose] = await draftGapKeys(
      fakeEvalContext(() => ({ ...ANSWER, notNeeded: [] })),
      [story('story-a')],
    )
    expect(loose!.errors).toEqual(expect.arrayContaining(['slot next is neither needed nor not needed']))
  })

  it('keeps no key from a failed call, and says why', async () => {
    const [failed] = await draftGapKeys(
      fakeEvalContext(() => null),
      [story('story-a')],
    )
    expect(failed).toEqual({ slug: 'story-a', outcome: 'parse_failure', key: null, errors: ['no draft: parse_failure'] })
  })
})

describe('the step', () => {
  let dir = ''
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = ''
  })

  const options = (extra: Partial<GapDraftStepOptions> = {}): GapDraftStepOptions => {
    dir ||= mkdtempSync(join(tmpdir(), 'gap-draft-'))
    return {
      ctx: fakeEvalContext(() => ANSWER),
      sampleFile: join(dir, 'cache', 'gap-sample.json'),
      refresh: false,
      loadCandidates: async () => ({ anchor: '2026-11-14', candidates: [candidate('a'), candidate('b', 'health', 4), candidate('gone'), candidate('dev')] }),
      developmentKeys: [{ file: 'dev.json', key: { entries: [{ slug: 'dev' }], nearMisses: [] } as unknown as AnswerKey, errors: [] }],
      inputs: async slugs => new Map(slugs.map(s => [s, s === 'gone' ? null : contextInput({ storyId: `id-${s}` })])),
      draftDir: join(dir, 'out', 'gap-drafts'),
      dryRun: false,
      gate: { budgetUsd: 5, canCall: true },
      now: new Date('2026-11-17T09:00:00Z'),
      ...extra,
    }
  }

  it('samples, loads the inputs, drafts each story with one and writes the drafts', async () => {
    const o = options()
    const report = await runGapDraftStep(o)
    expect(report).toMatchObject({ createdAt: '2026-11-17T09:00:00.000Z', anchor: '2026-11-14', candidates: 4, shortfalls: ['3 of 30 items available'] })
    expect(report.sample.map(s => s.slug).sort()).toEqual(['a', 'b', 'gone'])
    expect(report.sample.find(s => s.slug === 'b')).toEqual({ slug: 'b', issue: 'health', figures: 4, stratum: 'health · figure-heavy' })
    expect(report.noInput).toEqual(['gone'])
    expect(report.estimate).toMatchObject({ calls: 2, uncached: 2 })
    expect(report.stopped).toBeNull()
    expect(report.drafts.map(d => d.slug).sort()).toEqual(['a', 'b'])
    expect(report.written.sort()).toEqual([join(o.draftDir, 'a.json'), join(o.draftDir, 'b.json')])
    expect(JSON.parse(readFileSync(join(o.draftDir, 'a.json'), 'utf8'))).toMatchObject({ slug: 'a', date: '2026-11-14' })
  })

  it('keeps its sample: a second run reads the cache, and --refresh-fixtures samples again', async () => {
    await runGapDraftStep(options())
    const again = await runGapDraftStep(options({ loadCandidates: () => Promise.reject(new Error('no database')), now: new Date('2027-01-01T00:00:00Z') }))
    expect(again.createdAt).toBe('2026-11-17T09:00:00.000Z')
    const fresh = await runGapDraftStep(options({ refresh: true, loadCandidates: async () => ({ anchor: null, candidates: [] }) }))
    expect(fresh).toMatchObject({ anchor: null, candidates: 0, sample: [], drafts: [], written: [] })
  })

  it('drafts only the first --limit stories of the sample', async () => {
    const report = await runGapDraftStep(options({ limit: 1 }))
    expect(report.sample).toHaveLength(3)
    expect(report.drafts.length + report.noInput.length).toBe(1)
  })

  it('only estimates on a dry run, and drafts nothing the gate refuses', async () => {
    const throwing = fakeEvalContext(() => {
      throw new Error('no call')
    })
    const dry = await runGapDraftStep(options({ ctx: throwing, dryRun: true }))
    expect(dry).toMatchObject({ stopped: null, drafts: [], written: [], estimate: { calls: 2 } })
    expect(dry.estimate.usd).toBeGreaterThan(0)
    expect(existsSync(join(dir, 'out'))).toBe(false)
    const refused = await runGapDraftStep(options({ ctx: throwing, gate: { budgetUsd: 5, canCall: false } }))
    expect(refused.stopped).toMatch(/OPENAI_API_KEY/)
    expect(refused.drafts).toEqual([])
  })

  it('writes only the drafts that have a key, two-space JSON with a final newline', () => {
    dir = mkdtempSync(join(tmpdir(), 'gap-draft-'))
    const key = { schemaVersion: 1, slug: 'a', title: 'A', date: '2026-11-14', needs: [], notNeeded: [], notes: '' }
    const written = writeDrafts(join(dir, 'drafts'), [
      { slug: 'a', outcome: 'ok', key, errors: ['0 needs; a key has 2 to 8'] },
      { slug: 'b', outcome: 'parse_failure', key: null, errors: ['no draft: parse_failure'] },
    ])
    expect(written).toEqual([join(dir, 'drafts', 'a.json')])
    expect(readFileSync(written[0]!, 'utf8')).toBe(`${JSON.stringify(key, null, 2)}\n`)
  })
})

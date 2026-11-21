import { describe, expect, it } from 'vitest'
import { promptText, type Prompt } from '../../../lib/promptCache.js'
import type { LinkAnswer } from '../../../schemas/overviews.js'
import type { Neighbour } from '../../../services/overviewCandidates.js'
import { OVERVIEW_STEPS } from '../../../services/overviewSteps.js'
import type { LinkStory } from '../../../services/overviewTypes.js'
import { versionedSchemaName } from '../models.js'
import type { CallRecord } from '../types.js'
import type { KeyFile } from './keyFiles.js'
import type { AnswerKey } from './keySchema.js'
import { runLinkStep } from './link.js'

const DAYS = { a: 1, b: 2, c: 3 } as const
const story = (slug: keyof typeof DAYS): LinkStory => ({
  id: `id-${slug}`,
  title: `Story ${slug.toUpperCase()}`,
  label: 'Ebola',
  summary: `Summary ${slug}`,
  datePublished: new Date(Date.UTC(2026, 4, DAYS[slug])),
  date: `2026-05-0${DAYS[slug]}`,
  issueId: null,
  facts: [],
})

const key: AnswerKey = {
  schemaVersion: 1,
  id: 'ebola-drc-2026',
  title: 'Ebola',
  charter: { in: 'In.', out: [], endEvent: null },
  closed: null,
  figures: [],
  entries: (['a', 'b', 'c'] as const).map(slug => ({
    slug,
    date: story(slug).date,
    title: story(slug).title,
    join: 'must' as const,
    role: 'routine' as const,
    kind: null,
    values: [],
    statuses: [],
    why: 'w',
  })),
  nearMisses: [],
  responses: [],
  centers: [],
  notes: '',
}
const files: KeyFile[] = [{ file: 'ebola-drc-2026.json', key, errors: [] }]

/** Every link answer says no to every candidate; story C's call is not in the cache. */
function fakeCtx() {
  const names: string[] = []
  const call = async <T>(_a: unknown, schemaName: string, _schema: unknown, prompt: Prompt): Promise<CallRecord<T>> => {
    names.push(schemaName)
    const text = promptText(prompt)
    const refs = [...text.matchAll(/<(?:OVERVIEW|CANDIDATE) id="([OF]\d+)"/g)].map(m => m[1]!)
    const blank = { cause: { story: '', other: '' }, place: { story: '', other: '' }, end: { story: '', other: '' } }
    const answer: LinkAnswer = {
      candidates: refs.map(id => ({
        id,
        belongs: 'no',
        ...blank,
        reportsEndEvent: false,
        scope: 'unrelated',
        centerMoved: false,
        signalQuote: '',
        confidence: 0.2,
      })),
      role: 'routine',
      roleKind: null,
    }
    const skipped = text.includes('<TITLE>Story C</TITLE>')
    return {
      key: 'k',
      arm: 'a',
      schema: schemaName,
      outcome: skipped ? 'skipped' : 'ok',
      parsed: skipped ? null : (answer as T),
      content: '',
      finishReason: null,
      usage: { input: 0, cached: 0, output: 0, reasoning: 0 },
      costUsd: 0,
      latencyMs: 0,
      at: '',
    }
  }
  return { names, ctx: { call, spentUsd: () => 0 } }
}

const near = (slug: keyof typeof DAYS): Neighbour => ({ id: `id-${slug}`, datePublished: story(slug).datePublished, distance: 0.2, via: 'near' })

describe('runLinkStep', () => {
  it("diagnoses each run's missed must entries, counts the calls not made, and asks the cache under the step's own schema names", async () => {
    const { names, ctx } = fakeCtx()
    const report = await runLinkStep({
      ctx,
      files,
      half: 'judge',
      stories: async slugs => new Map(slugs.map(s => [s, s in DAYS ? story(s as keyof typeof DAYS) : null])),
      // The database's neighbours: one outside the replay, which is dropped but counted as read
      neighbours: async s => (s.id === 'id-b' ? [near('a')] : s.id === 'id-c' ? [near('a'), near('b'), { ...near('a'), id: 'elsewhere' }] : []),
      repeat: 2,
      concurrency: 1,
      budgetUsd: 1,
    })
    expect(report.diagnostics.map(d => d.run)).toEqual([1, 2])
    const causes = new Map(report.diagnostics[0]!.missed.map(m => [m.slug, m]))
    expect(causes.get('a')).toMatchObject({ cause: 'no candidate' })
    expect(causes.get('b')).toMatchObject({ cause: 'model no', detail: 'F1 0.20: no 0.20, unrelated; ebola-drc-2026 was never founded' })
    expect(causes.get('c')).toMatchObject({ cause: 'failed', detail: 'the link call gave no answer' })
    expect(report.unanswered).toBe(2)
    const link = versionedSchemaName(OVERVIEW_STEPS.link.name, OVERVIEW_STEPS.link.schema)
    expect(new Set(names)).toEqual(new Set([link, `${link}~run2`]))
    expect(report.score.role[0]!.value).toBeNull()
  })
})

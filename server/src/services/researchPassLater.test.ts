import { describe, expect, it } from 'vitest'
import { ZERO_USAGE } from '../lib/llmUsage.js'
import type { FactCheck, Repair } from '../schemas/research.js'
import type { JudgeAnswer, NoteAnswer } from '../schemas/researchPass.js'
import { buildResearchedStory } from './researchedStory.js'
import { updateArticle, type LaterStep, type UpdateDeps, type UpdateInput } from './researchPassLater.js'
import type { StepName } from './researchPipeline.js'
import { researchView, type Article, type ArticleVersionData, type PoolFact, type PoolSource } from './researchPool.js'

const src = (ref: string, outlet: string, date: string, origin: PoolSource['origin'] = 'search'): PoolSource => ({
  id: ref === 'S5' ? null : `src-${ref}`,
  ref,
  origin,
  earlierStoryId: null,
  url: `https://${outlet.toLowerCase()}.example/${ref}`,
  outlet,
  title: `${outlet} report`,
  date,
  kind: 'news-report',
  country: 'Indonesia',
  relation: 'same-development',
  favicon: null,
  usedRawContent: false,
  voices: [],
  optOutChecked: true,
  firstPassId: ref === 'S5' ? 'pass-2' : 'pass-1',
})

const fact = (ref: string, statement: string, measures = '', over: Partial<PoolFact> = {}): PoolFact => ({
  id: ref.startsWith('S5') ? null : `fact-${ref}`,
  ref,
  sourceRef: ref.replace(/F\d+$/, ''),
  reusedFromId: null,
  supportingSentence: `${statement} (as reported)`,
  passage: null,
  supportFound: true,
  statement,
  measures,
  slot: null,
  structured: null,
  extractedBy: { model: 'm', promptVersion: 'v' },
  verdict: 'supported',
  verdictProblem: null,
  checkedBy: null,
  status: 'unreviewed',
  firstPassId: ref.startsWith('S5') ? 'pass-2' : 'pass-1',
  drop: null,
  ...over,
})

const sources = [src('S0', 'News', '2026-11-14', 'original'), src('S1', 'Member', '2026-11-14', 'cluster'), src('S5', 'Agency', '2026-11-20')]
const facts = [
  fact('S0F1', 'Fires burned 2.88 million hectares.', 'hectares burned'),
  fact('S1F1', 'Smoke closed 40 schools.', 'schools closed'),
  fact('S1F2', 'Smoke reaches millions.'),
  fact('S5F1', 'The burned area was 3.1 million hectares.', 'hectares burned'),
  fact('S5F2', 'Only 12 schools closed.', 'schools closed'),
]

const article = (): Article => ({
  titleLabel: 'Peat fires',
  title: 'Peat fires return to Sumatra',
  story: [
    { text: 'Fires burned 2.88 million hectares.', factIds: ['S0F1'] },
    { text: 'Smoke closed 40 schools.', factIds: ['S1F1'] },
  ],
  whyThisMatters: [{ text: 'Smoke reaches millions.', factIds: ['S1F2'] }],
  caveats: [{ text: 'Figures are provisional.', factIds: [] }],
  summary: 'Fires burned 2.88 million hectares in Sumatra.',
  quote: '',
  quoteAttribution: '',
  quoteSourceId: '',
  marketingBlurb: 'Peat fires are back in Sumatra.',
  emotionTag: 'calm',
})

function version(over: Partial<ArticleVersionData> = {}): ArticleVersionData {
  const a = article()
  const before = { sources: sources.filter(s => s.ref !== 'S5'), facts: facts.filter(f => !f.ref.startsWith('S5')) }
  return {
    id: 'v1',
    number: 1,
    kind: 'first',
    status: 'current',
    passId: 'pass-1',
    title: a.title,
    titleLabel: a.titleLabel,
    summary: a.summary,
    marketingBlurb: a.marketingBlurb,
    quote: null,
    quoteAttribution: null,
    relevanceReasons: '- Smoke reaches millions.',
    antifactors: '- Figures are provisional.',
    emotionTag: 'calm',
    research: buildResearchedStory({ draft: a, ...researchView(before) }),
    article: a,
    changes: [],
    note: null,
    ...over,
  }
}

const input = (over: Partial<UpdateInput> = {}): UpdateInput => ({
  storyDay: '2026-11-14',
  version: version(),
  pool: { sources, facts },
  fresh: new Set(['S5F1', 'S5F2']),
  ...over,
})

const SKIP = Symbol('skip')
type Answer = (prompt: string) => unknown

const items = (prompt: string) => [...prompt.matchAll(/<ITEM number="(\d+)" label="([^"]+)">/g)].map(m => ({ number: Number(m[1]), label: m[2]! }))

/** Every item supported, but those labeled in `reject`. */
const checking =
  (reject: string[] = []): Answer =>
  prompt =>
    ({
      items: items(prompt).map(i => ({
        number: i.number,
        supported: !reject.includes(i.label),
        problem: reject.includes(i.label) ? 'Not what its facts say.' : '',
        key: false,
        copiedSentence: '',
        followsSource: '',
      })),
    }) satisfies FactCheck

const judging =
  (over: Partial<JudgeAnswer> = {}): Answer =>
  () =>
    ({ sections: [], contradicted: [], ...over }) satisfies JudgeAnswer
const repairing =
  (...repairs: Repair['items']): Answer =>
  () =>
    ({ items: repairs, quote: '', quoteAttribution: '', quoteSourceId: '' }) satisfies Repair
const noting =
  (text: string, factIds: string[]): Answer =>
  () =>
    ({ text, factIds }) satisfies NoteAnswer

const schoolsWrong = judging({
  sections: [{ label: 'Story paragraph 2', verdict: 'wrong', factIds: ['S5F2'], reason: 'Only 12 schools closed.' }],
  contradicted: [{ factId: 'S1F1', byFactIds: ['S5F2'], reason: 'The ministry counted 12, not 40.' }],
})

function fakeDeps(answers: Partial<Record<LaterStep | StepName, Answer>>) {
  const calls: { step: string; prompt: string }[] = []
  const answer = (step: string, prompt: string) => {
    calls.push({ step, prompt })
    const a = answers[step as LaterStep | StepName]?.(prompt) ?? null
    return {
      parsed: a === SKIP || a === null ? null : (a as never),
      outcome: a === SKIP ? ('skipped' as const) : a === null ? ('error' as const) : ('ok' as const),
    }
  }
  const deps: UpdateDeps = {
    call: async (step, _schema, prompt) => ({ ...answer(step, prompt), usage: ZERO_USAGE, costUsd: 0.001, model: `model-${step}` }),
    research: async (step, _schema, prompt) => answer(step, prompt),
  }
  return { deps, calls, steps: () => calls.map(c => c.step) }
}

const defaults = {
  judge: schoolsWrong,
  update: repairing({ label: 'Story paragraph 2', text: 'Smoke closed 12 schools.', factIds: ['S5F2'] }),
  'fact-check': checking(),
  rewrite: repairing(),
  note: noting('The education ministry counted 12 closed schools, not 40.', ['S5F2', 'S1F1']),
}

describe('updateArticle', () => {
  it('rewrites only the section newer reporting makes wrong, keeps every other byte for byte, and writes a checked Update', async () => {
    const fake = fakeDeps(defaults)
    const old = version()
    const r = await updateArticle(input({ version: old }), fake.deps)

    expect(r.outcome).toBe('updated')
    expect(r.demoted).toEqual([{ ref: 'S1F1', contradictedBy: ['S5F2'], reason: 'The ministry counted 12, not 40.' }])
    expect(r.next!.article.story[1]).toEqual({ text: 'Smoke closed 12 schools.', factIds: ['S5F2'] })
    expect(r.next!.changes).toEqual([
      {
        section: 'Story paragraph 2',
        from: 'Story paragraph 2',
        before: old.research.paragraphs[1]!.sentences[0],
        after: { text: 'Smoke closed 12 schools.', citations: [{ sourceId: 'S5', sentence: 'Only 12 schools closed. (as reported)' }] },
      },
    ])
    // Untouched sections are the old ones as readers saw them, the very objects
    expect(r.next!.research.paragraphs[0]).toBe(old.research.paragraphs[0])
    expect(r.next!.research.whyThisMatters[0]).toBe(old.research.whyThisMatters[0])
    expect(r.next!.research.sources.map(s => s.id)).toEqual(['S0', 'S1', 'S5'])
    expect(r.next!.note).toEqual({
      text: 'The education ministry counted 12 closed schools, not 40.',
      citations: [
        { sourceId: 'S5', sentence: 'Only 12 schools closed. (as reported)' },
        { sourceId: 'S1', sentence: 'Smoke closed 40 schools. (as reported)' },
      ],
    })
    expect(r.record.note).toEqual({
      text: 'The education ministry counted 12 closed schools, not 40.',
      fallback: false,
      problems: [],
      checked: 1,
      copied: 0,
      unsupported: 0,
    })
    // The rewrite is asked for the flagged section alone; the checks read it, then the note
    const update = fake.calls.find(c => c.step === 'update')!.prompt
    const repairs = update.slice(update.lastIndexOf('<REPAIRS>'), update.lastIndexOf('</REPAIRS>'))
    expect(repairs).toContain('Story paragraph 2')
    expect(repairs).not.toContain('Story paragraph 1')
    // The demoted fact is no longer offered to the rewrite
    expect(update).not.toContain('<FACT id="S1F1">')
    expect(fake.calls.filter(c => c.step === 'fact-check').map(c => items(c.prompt).map(i => i.label))).toEqual([['Story paragraph 2'], ['Update note']])
    expect(r.record.calls.map(c => c.step)).toEqual(['judge', 'update', 'note'])
  })

  it('rewrites a section citing a demoted fact even when the judge passes it, on a legacy version read from its citations', async () => {
    const legacy = version({ kind: 'legacy', article: null })
    const fake = fakeDeps({ ...defaults, judge: judging({ contradicted: [{ factId: 'S1F1', byFactIds: ['S5F2'], reason: 'Twelve, not forty.' }] }) })
    const r = await updateArticle(input({ version: legacy }), fake.deps)
    expect(r.outcome).toBe('updated')
    expect(r.record.judgments.find(j => j.label === 'Story paragraph 2')).toMatchObject({ verdict: null, outcome: 'demoted-fact', founding: ['S1F1'] })
    expect(r.next!.changes.map(c => c.section)).toEqual(['Story paragraph 2'])
  })

  it('leaves the article as it is when nothing is flagged, or a flag names no fact found since', async () => {
    const fake = fakeDeps({
      ...defaults,
      judge: judging({ sections: [{ label: 'Story paragraph 1', verdict: 'substantially_different', factIds: ['S0F1'], reason: 'From memory.' }] }),
    })
    const r = await updateArticle(input(), fake.deps)
    expect(r).toMatchObject({ outcome: 'unchanged', next: null, demoted: [] })
    expect(r.record.judgments.find(j => j.label === 'Story paragraph 1')!.outcome).toBe('unfounded')
    expect(fake.steps()).toEqual(['judge'])
  })

  it('asks no judge when the pass found no usable fact', async () => {
    const fake = fakeDeps(defaults)
    const rejected = facts.map(f => (f.ref.startsWith('S5') ? { ...f, verdict: 'rejected' as const } : f))
    const r = await updateArticle(input({ pool: { sources, facts: rejected } }), fake.deps)
    expect(r.outcome).toBe('unchanged')
    expect(fake.steps()).toEqual([])
  })

  it('drops a section that still fails after the rounds, recording it with no text after, and falls back to the fixed line without a note', async () => {
    const fake = fakeDeps({ ...defaults, 'fact-check': checking(['Story paragraph 2']), note: () => null })
    const r = await updateArticle(input(), fake.deps)
    expect(r.outcome).toBe('updated')
    expect(r.next!.article.story.map(p => p.text)).toEqual(['Fires burned 2.88 million hectares.'])
    expect(r.next!.changes).toEqual([
      { section: 'Story paragraph 2', from: 'Story paragraph 2', before: version().research.paragraphs[1]!.sentences[0], after: null },
    ])
    expect(r.next!.note).toEqual({
      text: 'Updated: Story paragraph 2 removed after new reporting from Agency.',
      citations: [{ sourceId: 'S1', sentence: 'Smoke closed 40 schools. (as reported)' }],
    })
    expect(r.record.note).toMatchObject({ fallback: true })
  })

  it('keeps the article and fails the update when a section it cannot do without still fails', async () => {
    const fake = fakeDeps({
      ...defaults,
      judge: judging({ sections: [{ label: 'Story paragraph 1', verdict: 'substantially_different', factIds: ['S5F1'], reason: 'Now 3.1 million.' }] }),
      update: repairing({ label: 'Story paragraph 1', text: 'Fires burned 3.1 million hectares.', factIds: ['S5F1'] }),
      'fact-check': checking(['Story paragraph 1']),
    })
    const r = await updateArticle(input(), fake.deps)
    expect(r).toMatchObject({ outcome: 'update_failed', next: null, record: { failedOn: 'Story paragraph 1' } })
    // The title, summary and blurb were taken up beside the opening paragraph
    const repairs = fake.calls.find(c => c.step === 'update')!.prompt
    expect(repairs.slice(repairs.lastIndexOf('<REPAIRS>'))).toContain('check it against the rewritten opening paragraph')
  })

  it('falls back to the fixed line when the note fails its checks twice', async () => {
    const fake = fakeDeps({ ...defaults, note: noting('The ministry said “only 12” schools closed.', ['S5F2']) })
    const r = await updateArticle(input(), fake.deps)
    expect(r.next!.note.text).toBe('Updated: Story paragraph 2 rewritten after new reporting from Agency.')
    // The code's checks failed it both times, so production's fact check never ran on it
    expect(r.record.note).toEqual({
      text: r.next!.note.text,
      fallback: true,
      problems: ['quotes words; an Update has no quotation marks'],
      checked: 0,
      copied: 0,
      unsupported: 0,
    })
    expect(fake.steps().filter(s => s === 'note')).toHaveLength(2)
    expect(fake.calls[fake.calls.length - 1]!.prompt).toContain('<PREVIOUS>')
  })

  it('counts the notes the checks ran on and those a copying check flagged', async () => {
    let round = 0
    const copyingOnce: Answer = prompt => {
      const answer = checking()(prompt) as FactCheck
      if (!prompt.includes('label="Update note"') || round++ > 0) return answer
      return { items: answer.items.map(i => ({ ...i, copiedSentence: 'S5F2' })) }
    }
    const r = await updateArticle(input(), fakeDeps({ ...defaults, 'fact-check': copyingOnce }).deps)
    expect(r.record.note).toMatchObject({ fallback: false, checked: 2, copied: 1, unsupported: 0 })
  })

  it('counts the notes the fact check found unsupported, the fixed line served after them', async () => {
    const r = await updateArticle(input(), fakeDeps({ ...defaults, 'fact-check': checking(['Update note']) }).deps)
    expect(r.next!.note.text).toBe('Updated: Story paragraph 2 rewritten after new reporting from Agency.')
    expect(r.record.note).toMatchObject({ fallback: true, checked: 2, copied: 0, unsupported: 2 })

    // A failed fact-check call is a problem with the note, not a verdict that it is unsupported
    let calls = 0
    const failingOnNote: Answer = prompt => (prompt.includes('label="Update note"') && calls++ === 0 ? null : checking()(prompt))
    const failed = await updateArticle(input(), fakeDeps({ ...defaults, 'fact-check': failingOnNote }).deps)
    expect(failed.record.note).toMatchObject({ fallback: false, checked: 2, unsupported: 0 })
  })

  it('ends on the budget when a call is skipped, and as a technical failure when one fails', async () => {
    for (const over of [{ judge: () => SKIP }, { update: () => SKIP }, { 'fact-check': () => SKIP }]) {
      const r = await updateArticle(input(), fakeDeps({ ...defaults, ...over }).deps)
      expect(r.outcome, Object.keys(over)[0]).toBe('budget')
      expect(r.next).toBeNull()
    }
    const r = await updateArticle(input(), fakeDeps({ ...defaults, judge: () => null }).deps)
    expect(r).toMatchObject({ outcome: 'technical', record: { error: 'judge: error' } })
  })
})

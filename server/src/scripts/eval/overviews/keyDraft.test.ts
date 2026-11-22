import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fakeEvalContext } from '../../../test/fakeEvalContext.js'
import type { KeyStory } from './keyCheck.js'
import {
  checkedDraft,
  draftableKeys,
  draftedJson,
  draftStories,
  KEY_DRAFT_ARM,
  keyDraftPrompt,
  MAX_RESPONSES_PER_STORY,
  runKeyDraftStep,
  type KeyDraftStepOptions,
} from './keyDraft.js'
import { readKeyFile, type KeyFile } from './keyFiles.js'
import { awaitingReview, type AnswerKey } from './keySchema.js'
import type { KeyDraftAnswer } from './prompts.js'

const ID = 'ebola-drc-2026'

const entry = (slug: string, date: string, join: 'must' | 'optional' = 'must') => ({
  slug,
  date,
  title: `Title ${slug}`,
  join,
  role: 'routine',
  kind: null,
  values: [],
  statuses: [],
  why: 'Belongs.',
})

/** A version 1 key as committed: no responses. */
const rawKey = (id = ID): Record<string, unknown> => ({
  schemaVersion: 1,
  id,
  title: id === ID ? 'Ebola in eastern DR Congo' : `Development ${id}`,
  charter: { in: 'The outbreak.', out: ['Uganda'], endEvent: 'DR Congo declares the outbreak over.' },
  figures: [],
  entries: [entry('a', '2026-05-01'), entry('b', '2026-05-03', 'optional'), entry('c', '2026-05-05'), entry('d', '2026-05-07')],
  nearMisses: [],
  notes: 'Uganda declaring its own outbreak over does not end it.',
})

const story = (slug: string, date: string, extra: Partial<KeyStory> = {}): KeyStory => ({
  slug,
  status: 'published',
  datePublished: new Date(`${date}T08:00:00Z`),
  title: `Title ${slug}`,
  summary: `Summary of ${slug}.`,
  relevanceReasons: null,
  antifactors: null,
  research: null,
  hasResearchRun: false,
  hasResearchFacts: false,
  ...extra,
})

const STORIES = new Map([
  ['a', story('a', '2026-05-01', { summary: 'WHO teams began ring vaccination in Bunia on Monday.' })],
  ['b', story('b', '2026-05-03', { summary: 'Uganda declared its outbreak over; Kenya flew in aid.' })],
  [
    'c',
    story('c', '2026-05-05', {
      summary: 'Treatment centres opened in Beni. Health workers trace contacts.',
      relevanceReasons: '- Ring vaccination continues.',
    }),
  ],
  ['d', story('d', '2026-05-07', { summary: 'Congo’s health ministry declared the outbreak over on 6 May.' })],
])

const keyOf = (raw: Record<string, unknown> = rawKey()): AnswerKey => {
  const dir = mkdtempSync(join(tmpdir(), 'key-draft-key-'))
  try {
    writeFileSync(join(dir, `${String(raw.id)}.json`), JSON.stringify(raw))
    return readKeyFile(join(dir, `${String(raw.id)}.json`)).key!
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const ANSWER: KeyDraftAnswer = {
  responses: [
    { story: 'S1', what: 'WHO ring vaccination in Bunia', quote: 'began ring vaccination in Bunia' },
    { story: 'S3', what: 'Treatment centres in Beni', quote: 'Treatment centres opened in Beni.' },
  ],
}

describe('draftableKeys', () => {
  const file = (raw: Record<string, unknown>, errors: string[] = []): KeyFile => ({ file: `${String(raw.id)}.json`, key: keyOf(raw), errors })

  it("drafts into the half's version 1 keys and says why it leaves the others alone", () => {
    const files: KeyFile[] = [
      file(rawKey()),
      file({ ...rawKey('el-nino-2026'), schemaVersion: 2 }),
      file(rawKey('lebanon-war-2026'), ['figure deaths has 2 values, fewer than 3']),
      { file: 'broken.json', key: null, errors: ['not valid JSON'] },
      file(rawKey('hormuz-shipping-2026')),
    ]
    const { keys, skipped } = draftableKeys(files, 'judge')
    expect(keys.map(k => k.key.id)).toEqual([ID])
    expect(skipped).toEqual([
      { file: 'el-nino-2026.json', reason: 'already version 2 (its responses drafted or written): left as it is' },
      { file: 'lebanon-war-2026.json', reason: '1 format errors: fix the key' },
      { file: 'broken.json', reason: '1 format errors: fix the key' },
    ])
    expect(draftableKeys(files, 'all').keys.map(k => k.key.id)).toEqual([ID, 'hormuz-shipping-2026'])
    expect(draftableKeys(files, 'all', 1).keys).toHaveLength(1)
  })
})

describe('the prompt', () => {
  it("shows every entry published here with its id, join, day and named published fields, and the key's notes", () => {
    const { shown, missing } = draftStories(keyOf(), new Map([...STORIES].filter(([slug]) => slug !== 'd')))
    expect(shown.map(s => [s.id, s.slug, s.join, s.date])).toEqual([
      ['S1', 'a', 'must', '2026-05-01'],
      ['S2', 'b', 'optional', '2026-05-03'],
      ['S3', 'c', 'must', '2026-05-05'],
    ])
    expect(missing).toEqual(['d'])
    const prompt = keyDraftPrompt(keyOf(), shown)
    expect(prompt).toContain('<STORY id="S3" join="must" date="2026-05-05">\n<TITLE>Title c</TITLE>\n<SUMMARY>Treatment centres opened in Beni.')
    expect(prompt).toContain('<WHY_IT_MATTERS>- Ring vaccination continues.</WHY_IT_MATTERS>')
    expect(prompt).not.toContain('<CAVEATS>')
    expect(prompt).toContain('Uganda declaring its own outbreak over does not end it.')
    expect(prompt).toContain(`marked join="must", at most ${MAX_RESPONSES_PER_STORY} a story`)
  })
})

describe('checkedDraft', () => {
  const { shown } = draftStories(keyOf(), STORIES)
  const check = (answer: KeyDraftAnswer) => checkedDraft(shown, answer)

  it("keeps each must story's response its text states, dated by its story and marked a draft", () => {
    const d = check(ANSWER)
    expect(d.responses).toEqual([
      { date: '2026-05-01', what: 'WHO ring vaccination in Bunia', slug: 'a', quote: 'began ring vaccination in Bunia', reviewed: false },
      { date: '2026-05-05', what: 'Treatment centres in Beni', slug: 'c', quote: 'Treatment centres opened in Beni.', reviewed: false },
    ])
    expect(d.left).toEqual([])
  })

  it('leaves out what it cannot check, and says why', () => {
    const d = check({
      responses: [
        { story: 'S2', what: 'Kenyan aid', quote: 'Kenya flew in aid' },
        { story: 'S9', what: 'Unknown', quote: 'x' },
        { story: 'S1', what: 'Mass vaccination', quote: 'began mass vaccination' },
        { story: 'S1', what: ' ', quote: 'ring vaccination' },
        ...Array.from({ length: MAX_RESPONSES_PER_STORY + 1 }, (_, i) => ({ story: 'S3', what: `Response ${i + 1}`, quote: 'trace contacts' })),
      ],
    })
    expect(d.responses.map(r => r.what)).toEqual(Array.from({ length: MAX_RESPONSES_PER_STORY }, (_, i) => `Response ${i + 1}`))
    expect(d.left).toEqual([
      'response "Kenyan aid": S2 (b) is not a must entry',
      'response "Unknown": no story S9',
      'response "Mass vaccination": quote not found in a: "began mass vaccination"',
      'response on a: no text for what is being done',
      `response "Response ${MAX_RESPONSES_PER_STORY + 1}": more than ${MAX_RESPONSES_PER_STORY} for c`,
    ])
  })
})

describe('draftedJson', () => {
  it('raises the key to version 2 and adds the drafts before the notes, every other field as it was', () => {
    const d = checkedDraft(draftStories(keyOf(), STORIES).shown, ANSWER)
    const out = draftedJson(rawKey(), d)
    expect(Object.keys(out)).toEqual(['schemaVersion', 'id', 'title', 'charter', 'figures', 'entries', 'nearMisses', 'responses', 'notes'])
    expect(out).toMatchObject({ schemaVersion: 2, responses: d.responses, entries: rawKey().entries })
  })
})

describe('the step', () => {
  let dir = ''
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = ''
  })

  const options = (extra: Partial<KeyDraftStepOptions> = {}): KeyDraftStepOptions => {
    dir ||= mkdtempSync(join(tmpdir(), 'key-draft-'))
    for (const raw of [rawKey(), rawKey('el-nino-2026')]) writeFileSync(join(dir, `${String(raw.id)}.json`), `${JSON.stringify(raw, null, 2)}\n`)
    return {
      ctx: fakeEvalContext((_schema, prompt) => (prompt.includes('Ebola in eastern DR Congo') ? ANSWER : { responses: [] })),
      files: [readKeyFile(join(dir, `${ID}.json`)), readKeyFile(join(dir, 'el-nino-2026.json'))],
      half: 'judge',
      stories: async slugs => new Map(slugs.flatMap(s => (STORIES.has(s) ? [[s, STORIES.get(s)!] as const] : []))),
      keysDir: dir,
      dryRun: false,
      gate: { budgetUsd: 5, canCall: true },
      ...extra,
    }
  }

  it('asks once a key, writes the drafts into each key that has some, and leaves a key with none as it was', async () => {
    const o = options()
    const before = readFileSync(join(dir, 'el-nino-2026.json'), 'utf8')
    const report = await runKeyDraftStep(o)
    expect((o.ctx as ReturnType<typeof fakeEvalContext>).calls.map(c => c.arm)).toEqual([KEY_DRAFT_ARM, KEY_DRAFT_ARM])
    expect(report.estimate).toMatchObject({ calls: 2, uncached: 2 })
    expect(report.written).toEqual([join(dir, `${ID}.json`)])
    expect(report.drafts.map(d => [d.id, d.outcome, d.responses.length, d.written])).toEqual([
      [ID, 'ok', 2, true],
      ['el-nino-2026', 'ok', 0, false],
    ])
    expect(readFileSync(join(dir, 'el-nino-2026.json'), 'utf8')).toBe(before)
    // The drafted key keeps the format, and the steps that read it refuse it until it is reviewed
    const written = readKeyFile(join(dir, `${ID}.json`))
    expect(written.errors).toEqual([])
    expect(written.key).toMatchObject({ schemaVersion: 2 })
    expect(awaitingReview([written.key!], 'responses')).toMatch(/^refused: 2 drafted responses/)
    expect(readFileSync(join(dir, `${ID}.json`), 'utf8').endsWith('\n')).toBe(true)
  })

  it('only estimates on a dry run, calls nothing the gate refuses, and writes nothing from a failed call', async () => {
    const throwing = fakeEvalContext(() => {
      throw new Error('no call')
    })
    const dry = await runKeyDraftStep(options({ ctx: throwing, dryRun: true }))
    expect(dry).toMatchObject({ stopped: null, drafts: [], written: [], estimate: { calls: 2 } })
    expect(dry.estimate.usd).toBeGreaterThan(0)
    const refused = await runKeyDraftStep(options({ ctx: throwing, gate: { budgetUsd: 5, canCall: false } }))
    expect(refused.stopped).toMatch(/OPENAI_API_KEY/)
    expect(refused.written).toEqual([])
    const failed = await runKeyDraftStep(options({ ctx: fakeEvalContext(() => null) }))
    expect(failed.drafts.map(d => [d.outcome, d.written])).toEqual([
      ['parse_failure', false],
      ['parse_failure', false],
    ])
    expect(readKeyFile(join(dir, `${ID}.json`)).key?.schemaVersion).toBe(1)
  })

  it('reads no story when no key is left to draft', async () => {
    let asked = 0
    const report = await runKeyDraftStep(
      options({
        half: 'tune',
        stories: async () => {
          asked += 1
          return new Map()
        },
      }),
    )
    expect([asked, report.drafts, report.estimate.calls]).toEqual([0, [], 0])
  })
})

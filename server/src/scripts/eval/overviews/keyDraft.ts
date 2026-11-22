/**
 * Drafting the answer keys' responses (the `key-draft` step of `eval:overviews`;
 * `.context/model-eval.md`, "key-draft"): for each development key of `--half` still at version 1,
 * one call to the strong model with the key's charter and notes and its entries' published text
 * (`loadKeyStories`, through the read-only session), asking what each must entry reports as being
 * done about the development. Code keeps only what it
 * can check: a story the prompt showed, a must entry for a response, at most
 * `MAX_RESPONSES_PER_STORY` a story, a quote found in that story's published text as the `keys`
 * step finds it; a response is dated by its story. What it keeps goes into the committed key file
 * as drafts (`reviewed: false`) and the key becomes version 2; the steps that read them refuse
 * until a person has reviewed every one (`awaitingReview`). Pure but for the calls and the files
 * read and written.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { versionedSchemaName } from '../models.js'
import type { CallOutcome, PlannedCall, SuiteContext } from '../types.js'
import { estimateCalls, refusal, type CallEstimate, type CallGate, type Ledger } from './callBudget.js'
import { inDevelopmentHalf } from './developmentHalves.js'
import { LABEL_ARM } from './factCheck.js'
import { publishedFields, statesQuote, type KeyStory } from './keyCheck.js'
import type { KeyFile } from './keyFiles.js'
import type { AnswerKey } from './keySchema.js'
import { buildKeyDraftPrompt, keyDraftSchema, type KeyDraftAnswer, type KeyDraftStory } from './prompts.js'

/** The drafter: the strong arm the fact check's labels and the gap-key drafts run on. */
export const KEY_DRAFT_ARM = LABEL_ARM
const KEY_DRAFT_SCHEMA = versionedSchemaName('overview-key-draft', keyDraftSchema)
/**
 * Responses kept a story. One is all the stands bar reads (a checkpoint is due when any response by
 * then has a story with current facts, `stands.ts`), so a second would cost review time and add nothing.
 */
export const MAX_RESPONSES_PER_STORY = 1
/** Billed output at medium effort, reasoning included: a base and each story's share. The estimate only. */
const OUTPUT_TOKENS_BASE = 1500
const OUTPUT_TOKENS_PER_STORY = 150

type Response = AnswerKey['responses'][number]
type Half = 'tune' | 'judge' | 'all'

/** The keys the step drafts into, and the files it leaves alone with why (a key of another half is not listed). */
export function draftableKeys(files: KeyFile[], half: Half, limit?: number) {
  const keys: { file: string; key: AnswerKey }[] = []
  const skipped: { file: string; reason: string }[] = []
  for (const f of files) {
    if (!f.key || f.errors.length > 0) skipped.push({ file: f.file, reason: `${f.errors.length} format errors: fix the key` })
    else if (!inDevelopmentHalf(f.key.id, half)) continue
    else if (f.key.schemaVersion !== 1) skipped.push({ file: f.file, reason: 'already version 2 (its responses drafted or written): left as it is' })
    else keys.push({ file: f.file, key: f.key })
  }
  return { keys: limit === undefined ? keys : keys.slice(0, limit), skipped }
}

/** A story the prompt shows: its id there (`S1`… in entry order) and the entry it is. */
export interface ShownStory extends KeyDraftStory {
  slug: string
  story: KeyStory
}

/** The key's entries published in this database, as the prompt shows them; the slugs of the others. */
export function draftStories(key: AnswerKey, stories: ReadonlyMap<string, KeyStory>): { shown: ShownStory[]; missing: string[] } {
  const shown: ShownStory[] = []
  const missing: string[] = []
  for (const e of key.entries) {
    const story = stories.get(e.slug)
    if (!story || story.status !== 'published') missing.push(e.slug)
    else shown.push({ id: `S${shown.length + 1}`, slug: e.slug, join: e.join, date: e.date, fields: publishedFields(story), story })
  }
  return { shown, missing }
}

export const keyDraftPrompt = (key: AnswerKey, shown: KeyDraftStory[]): string =>
  buildKeyDraftPrompt({
    title: key.title,
    charter: { in: key.charter.in, out: key.charter.out },
    notes: key.notes,
    stories: shown,
    perStory: MAX_RESPONSES_PER_STORY,
  })

const plannedCall = (key: AnswerKey, shown: ShownStory[]): PlannedCall => ({
  arm: KEY_DRAFT_ARM,
  schemaName: KEY_DRAFT_SCHEMA,
  prompt: keyDraftPrompt(key, shown),
  baseOutputTokens: OUTPUT_TOKENS_BASE + OUTPUT_TOKENS_PER_STORY * shown.length,
})

/** What code kept of an answer, as drafts; and what it left out, with why. */
export interface CheckedDraft {
  responses: Response[]
  left: string[]
}

/** The answer checked against the stories the prompt showed: only what their published text states is kept. */
export function checkedDraft(shown: ShownStory[], answer: KeyDraftAnswer): CheckedDraft {
  const byId = new Map(shown.map(s => [s.id, s]))
  const left: string[] = []
  const perStory = new Map<string, number>()
  const responses: Response[] = []
  for (const r of answer.responses) {
    const s = byId.get(r.story.trim())
    const what = r.what.trim()
    if (!s) left.push(`response "${what}": no story ${r.story}`)
    else if (s.join !== 'must') left.push(`response "${what}": ${s.id} (${s.slug}) is not a must entry`)
    else if (!what) left.push(`response on ${s.slug}: no text for what is being done`)
    else if (!statesQuote(s.story, r.quote)) left.push(`response "${what}": quote not found in ${s.slug}: "${r.quote}"`)
    else if ((perStory.get(s.slug) ?? 0) >= MAX_RESPONSES_PER_STORY) left.push(`response "${what}": more than ${MAX_RESPONSES_PER_STORY} for ${s.slug}`)
    else {
      perStory.set(s.slug, (perStory.get(s.slug) ?? 0) + 1)
      responses.push({ date: s.date, what, slug: s.slug, quote: r.quote, reviewed: false })
    }
  }
  responses.sort((a, b) => a.date.localeCompare(b.date))
  return { responses, left }
}

/** The committed key's JSON with the drafts: version 2, the responses before the notes; every other field as it was. */
export function draftedJson(raw: Record<string, unknown>, drafts: Pick<CheckedDraft, 'responses'>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(raw)) {
    if (field === 'responses') continue
    if (field === 'notes') out.responses = drafts.responses
    out[field] = field === 'schemaVersion' ? 2 : value
  }
  if (!('responses' in out)) out.responses = drafts.responses
  return out
}

// ---------------------------------------------------------------------------
// The step
// ---------------------------------------------------------------------------

export interface KeyDraftStepOptions {
  ctx: SuiteContext & Ledger
  files: KeyFile[]
  half: Half
  /** Only the first N keys to draft (a smoke run). */
  limit?: number
  stories(slugs: string[]): Promise<ReadonlyMap<string, KeyStory>>
  /** The folder of the key files the drafts go into: the committed `keys/` (`KEYS_DIR`). */
  keysDir: string
  dryRun: boolean
  gate: CallGate
}

export interface KeyDraftResult extends CheckedDraft {
  id: string
  file: string
  title: string
  outcome: CallOutcome
  /** Each entry's published title by slug, for the report. */
  titles: Record<string, string>
  /** Entries not published in this database, left out of the prompt. */
  missing: string[]
  /** Whether drafts went into the key file. */
  written: boolean
}

export interface KeyDraftReport {
  half: Half
  keys: string[]
  skipped: { file: string; reason: string }[]
  estimate: CallEstimate
  /** Why the calls did not run (the budget or the API key), or null. */
  stopped: string | null
  drafts: KeyDraftResult[]
  /** The key files the drafts went into. */
  written: string[]
}

export async function runKeyDraftStep(o: KeyDraftStepOptions): Promise<KeyDraftReport> {
  const { keys, skipped } = draftableKeys(o.files, o.half, o.limit)
  const slugs = [...new Set(keys.flatMap(k => k.key.entries.map(e => e.slug)))]
  const stories = slugs.length === 0 ? new Map<string, KeyStory>() : await o.stories(slugs)
  const cases = keys.map(k => ({ ...k, ...draftStories(k.key, stories) }))
  const asked = cases.filter(c => c.shown.length > 0)
  const estimate = estimateCalls(
    o.ctx,
    asked.map(c => plannedCall(c.key, c.shown)),
  )
  const stopped = o.dryRun ? null : refusal(estimate, o.ctx, o.gate)
  const report = { half: o.half, keys: keys.map(k => k.key.id), skipped, estimate, stopped }
  if (o.dryRun || stopped) return { ...report, drafts: [], written: [] }

  const drafts = await Promise.all(
    asked.map(async (c): Promise<KeyDraftResult> => {
      const call = plannedCall(c.key, c.shown)
      const rec = await o.ctx.call(call.arm, call.schemaName, keyDraftSchema, call.prompt)
      const base = { id: c.key.id, file: c.file, title: c.key.title, outcome: rec.outcome, titles: titlesOf(c.key), missing: c.missing }
      if (rec.outcome !== 'ok' || !rec.parsed) return { ...base, responses: [], left: [`no draft: ${rec.outcome}`], written: false }
      const checked = checkedDraft(c.shown, rec.parsed)
      const written = checked.responses.length > 0
      if (written) writeDrafts(join(o.keysDir, c.file), checked)
      return { ...base, ...checked, written }
    }),
  )
  return { ...report, drafts, written: drafts.filter(d => d.written).map(d => join(o.keysDir, d.file)) }
}

const titlesOf = (key: AnswerKey): Record<string, string> => Object.fromEntries(key.entries.map(e => [e.slug, e.title]))

/** The drafts into the key file as it is on disk now, two-space JSON with a final newline (`npm run format` gives the committed layout). */
function writeDrafts(path: string, drafts: Pick<CheckedDraft, 'responses'>): void {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  writeFileSync(path, `${JSON.stringify(draftedJson(raw, drafts), null, 2)}\n`)
}

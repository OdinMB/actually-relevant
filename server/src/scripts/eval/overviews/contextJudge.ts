/**
 * The `context` step's strong judge (gpt-6.1-sol@high, the fact check's label arm): on each story's
 * run of production's pipeline, which open needs of the gap key the kept cards meet (citing fact
 * ids), whether each kept sentence, tile and chart is supported by its cited facts (production's own
 * fact-check prompt on production's box items, so the yardstick is the prompt the step uses), and
 * whether each note `model` or `random` placement puts beside a paragraph or point adds to it; and
 * once over all runs, whether up to 300 figure facts' structured fields are right. Each call is
 * built once, for the plan (`plannedJudgeCalls`, the budget gate) and for the run. Calls go through
 * the eval context (cache, ledger, budget), plain schema names: the judge is not repeated.
 */
import type { z } from 'zod'
import { config } from '../../../config.js'
import { buildFactCheckPrompt } from '../../../prompts/research.js'
import { factCheckSchema, type FactCheck } from '../../../schemas/research.js'
import { boxCheckItems, promptItems, renderFact, type BoxItem, type ContextFactData } from '../../../services/storyContextChecks.js'
import type { ContextInput, StoryContextResult } from '../../../services/storyContextPipeline.js'
import { SECTION } from '../../../services/storyContextPlacement.js'
import { placeServed, servedBoxes } from '../../../services/storyContextServed.js'
import { versionedSchemaName } from '../models.js'
import type { PlannedCall, SuiteContext } from '../types.js'
import type { FieldLabel, ItemVerdict, JudgedMode, NeedVerdict, NoteVerdict, StoryRun } from './contextScore.js'
import { LABEL_ARM } from './factCheck.js'
import type { GapKey } from './gapKeySchema.js'
import {
  buildFieldsJudgePrompt,
  buildNeedsJudgePrompt,
  buildPlacementJudgePrompt,
  fieldsJudgeSchema,
  needsJudgeSchema,
  placementJudgeSchema,
  storyTextOf,
  type FieldsJudgeAnswer,
  type NeedsJudgeAnswer,
  type PlacementJudgeAnswer,
} from './prompts.js'

export const JUDGE_ARM = LABEL_ARM
/** Production's batch for its box check. */
export const BOX_ITEMS_PER_CALL = 25
export const FIELD_FACTS_PER_CALL = 10
/** The structured-fields bar is read on up to this many figure facts. */
export const MAX_FIELD_FACTS = 300

const NEEDS_SCHEMA = versionedSchemaName('overview-context-needs', needsJudgeSchema)
const BOX_SUPPORT_SCHEMA = versionedSchemaName('overview-box-support', factCheckSchema)
const PLACEMENT_SCHEMA = versionedSchemaName('overview-context-placement', placementJudgeSchema)
const FIELDS_SCHEMA = versionedSchemaName('overview-context-fields', fieldsJudgeSchema)

/** One story's run of production's pipeline, as the judges read it. */
export interface JudgedRun {
  slug: string
  /** 1-based. */
  run: number
  key: GapKey
  input: ContextInput
  result: StoryContextResult
}

interface JudgeCall<T> {
  schemaName: string
  schema: z.ZodType<T>
  prompt: string
  /** Billed output expected at medium effort: the estimate only. */
  outputTokens: number
}

const windows = () => ({ fastDays: config.storyContext.fastValidDays, slowDays: config.storyContext.slowValidDays })

const supportedFacts = (result: StoryContextResult) => new Map(result.facts.filter(f => f.verdict === 'supported').map(f => [f.ref, f]))

/** Production's box-check items of the kept cards. */
export const keptItems = (r: JudgedRun): BoxItem[] => boxCheckItems(r.result.boxes, supportedFacts(r.result), r.input.storyDay, windows())

const openNeeds = (key: GapKey) => key.needs.filter(n => n.inStory === null)

// ---------------------------------------------------------------------------
// Needs met
// ---------------------------------------------------------------------------

function needsCall(r: JudgedRun, items: BoxItem[]): JudgeCall<NeedsJudgeAnswer> | null {
  if (items.length === 0) return null
  const facts = supportedFacts(r.result)
  const cited = [...new Set(items.flatMap(i => i.checked.item.factIds))].flatMap(id => facts.get(id) ?? [])
  const prompt = buildNeedsJudgePrompt({
    story: storyTextOf(r.input),
    needs: openNeeds(r.key).map(n => ({ id: n.id, slot: n.slot, kind: n.kind, need: n.need, accepts: n.accepts })),
    items: items.map(i => ({ label: i.checked.item.label, slot: r.result.boxes[i.box]!.type, text: i.checked.item.text, factIds: i.checked.item.factIds })),
    facts: cited.map(f => ({ id: f.ref, text: renderFact(f), outlet: f.source.outlet, date: f.source.date })),
  })
  return { schemaName: NEEDS_SCHEMA, schema: needsJudgeSchema, prompt, outputTokens: 120 * openNeeds(r.key).length }
}

function readNeeds(key: GapKey, answer: NeedsJudgeAnswer | null, why: string): NeedVerdict[] {
  const byId = new Map<string, NeedsJudgeAnswer['needs'][number]>()
  for (const v of answer?.needs ?? []) if (!byId.has(v.id)) byId.set(v.id, v)
  return openNeeds(key).map(n => {
    const v = byId.get(n.id)
    return v ? { id: n.id, met: v.met, factIds: v.met ? v.factIds : [], why: v.why } : { id: n.id, met: false, factIds: [], why }
  })
}

// ---------------------------------------------------------------------------
// Box support: production's fact-check prompt on the kept items
// ---------------------------------------------------------------------------

const batches = <T>(list: T[], size: number): T[][] => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size))

const boxCall = (batch: BoxItem[]): JudgeCall<FactCheck> => ({
  schemaName: BOX_SUPPORT_SCHEMA,
  schema: factCheckSchema,
  prompt: buildFactCheckPrompt(promptItems(batch.map(b => b.checked)), [], []),
  outputTokens: 150 * batch.length,
})

function readItems(batch: BoxItem[], answer: FactCheck | null): ItemVerdict[] {
  const byNumber = new Map<number, FactCheck['items'][number]>()
  for (const v of answer?.items ?? []) if (!byNumber.has(v.number)) byNumber.set(v.number, v)
  return batch.map((b, i) => {
    const v = byNumber.get(i + 1)
    return { label: b.checked.item.label, text: b.checked.item.text, supported: v?.supported ?? null, problem: v?.problem ?? '' }
  })
}

// ---------------------------------------------------------------------------
// Placement: the notes beside the text in `model` and `random` mode
// ---------------------------------------------------------------------------

const JUDGED_MODES: JudgedMode[] = ['model', 'random']

export interface NoteToJudge {
  /** The modes that put this box at this place. */
  modes: JudgedMode[]
  box: number
  place: string
}

/** Each box at each place a mode puts it beside the text, once, in mode then box order: the boxes the page would serve, placed as it places them. */
export function notesToJudge(r: JudgedRun): NoteToJudge[] {
  const boxes = r.result.boxes.map((b, i) => ({ id: String(i), type: b.type, hidden: false, place: b.place, placeByEditor: false, content: b }))
  const served = servedBoxes(boxes, new Map(r.result.facts.map(f => [f.ref, f])), r.input.storyDay)
  const notes: NoteToJudge[] = []
  for (const mode of JUDGED_MODES) {
    for (const { box: placed, place } of placeServed(served, { storyId: r.input.storyId, layout: r.input.layout, mode })) {
      if (place === SECTION) continue
      const box = Number(placed.id)
      const same = notes.find(n => n.box === box && n.place === place)
      if (same) same.modes.push(mode)
      else notes.push({ modes: [mode], box, place })
    }
  }
  return notes
}

function placementCall(r: JudgedRun, notes: NoteToJudge[], items: BoxItem[]): JudgeCall<PlacementJudgeAnswer> | null {
  if (notes.length === 0) return null
  const spots = new Map([...r.input.layout.paragraphs, ...r.input.layout.points].map(s => [s.id, s.text]))
  const prompt = buildPlacementJudgePrompt({
    story: storyTextOf(r.input),
    notes: notes.map(n => {
      const box = r.result.boxes[n.box]!
      return {
        passage: { id: n.place, text: spots.get(n.place) ?? '' },
        card: { slot: box.type, heading: box.heading, items: items.filter(i => i.box === n.box).map(i => i.checked.item.text) },
      }
    }),
  })
  return { schemaName: PLACEMENT_SCHEMA, schema: placementJudgeSchema, prompt, outputTokens: 150 * notes.length }
}

function readNotes(notes: NoteToJudge[], answer: PlacementJudgeAnswer | null): NoteVerdict[] {
  const byNumber = new Map<number, PlacementJudgeAnswer['notes'][number]>()
  for (const v of answer?.notes ?? []) if (!byNumber.has(v.number)) byNumber.set(v.number, v)
  return JUDGED_MODES.flatMap(mode =>
    notes.flatMap((n, i) => {
      if (!n.modes.includes(mode)) return []
      const v = byNumber.get(i + 1)
      return [{ mode, box: n.box, place: n.place, adds: v?.adds ?? null, why: v?.why ?? '' }]
    }),
  )
}

// ---------------------------------------------------------------------------
// Structured fields of figure facts
// ---------------------------------------------------------------------------

export interface FieldFact {
  /** `<slug>#<run>:<ref>`. */
  key: string
  run: number
  fact: ContextFactData
}

/** Each run's own figure facts (none reused), taken in turn from each run, at most `max`. */
export function figureFacts(runs: JudgedRun[], max: number = MAX_FIELD_FACTS): FieldFact[] {
  const lists = runs.map(r =>
    r.result.facts.filter(f => f.value !== null && f.reusedFromId === null).map(fact => ({ key: `${r.slug}#${r.run}:${fact.ref}`, run: r.run, fact })),
  )
  const out: FieldFact[] = []
  for (let i = 0; out.length < max && lists.some(l => l.length > i); i++) for (const l of lists) if (l[i] && out.length < max) out.push(l[i]!)
  return out
}

const fieldsCall = (batch: FieldFact[]): JudgeCall<FieldsJudgeAnswer> => ({
  schemaName: FIELDS_SCHEMA,
  schema: fieldsJudgeSchema,
  prompt: buildFieldsJudgePrompt(
    batch.map(({ fact: f }) => ({
      evidence: f.passage ?? f.supportingSentence,
      statement: f.statement,
      outlet: f.source.outlet,
      date: f.source.date,
      value: f.value,
      valueHigh: f.valueHigh,
      unit: f.unit,
      approx: f.approx,
      counted: f.counted,
      place: f.place,
      asOf: f.asOf,
      credited: f.credited,
    })),
  ),
  outputTokens: 200 * batch.length,
})

function readFields(batch: FieldFact[], answer: FieldsJudgeAnswer | null): FieldLabel[] {
  const byNumber = new Map<number, FieldsJudgeAnswer['facts'][number]>()
  for (const v of answer?.facts ?? []) if (!byNumber.has(v.number)) byNumber.set(v.number, v)
  return batch.flatMap((f, i) => {
    const v = byNumber.get(i + 1)
    if (!v) return []
    const { value, unit, counted, place, asOf, credited } = v
    return [
      { key: f.key, run: f.run, verdict: f.fact.verdict, right: { value, unit, counted, place, asOf, credited }, invented: v.invented, problem: v.problem },
    ]
  })
}

// ---------------------------------------------------------------------------
// The plan and the run
// ---------------------------------------------------------------------------

function callsOf(r: JudgedRun) {
  const items = keptItems(r)
  const notes = notesToJudge(r)
  return {
    items,
    notes,
    needs: needsCall(r, items),
    boxes: batches(items, BOX_ITEMS_PER_CALL).map(batch => ({ batch, call: boxCall(batch) })),
    placement: placementCall(r, notes, items),
  }
}

const fieldBatches = (runs: JudgedRun[]) => batches(figureFacts(runs), FIELD_FACTS_PER_CALL).map(batch => ({ batch, call: fieldsCall(batch) }))

const planned = (c: JudgeCall<unknown>): PlannedCall => ({ arm: JUDGE_ARM, schemaName: c.schemaName, prompt: c.prompt, baseOutputTokens: c.outputTokens })

/** Every call `judgeContext` makes on these runs. */
export function plannedJudgeCalls(runs: JudgedRun[]): PlannedCall[] {
  const perRun = runs.flatMap(r => {
    const c = callsOf(r)
    return [...(c.needs ? [c.needs] : []), ...c.boxes.map(b => b.call), ...(c.placement ? [c.placement] : [])]
  })
  return [...perRun, ...fieldBatches(runs).map(b => b.call)].map(planned)
}

export async function judgeContext(ctx: SuiteContext, runs: JudgedRun[]): Promise<{ stories: StoryRun[]; fields: FieldLabel[] }> {
  const ask = async <T>(c: JudgeCall<T>): Promise<T | null> => {
    const rec = await ctx.call(JUDGE_ARM, c.schemaName, c.schema, c.prompt)
    return rec.outcome === 'ok' ? rec.parsed : null
  }
  const stories = await Promise.all(
    runs.map(async (r): Promise<StoryRun> => {
      const c = callsOf(r)
      const [needs, items, notes] = await Promise.all([
        c.needs ? ask(c.needs).then(a => readNeeds(r.key, a, 'no verdict')) : Promise.resolve(readNeeds(r.key, null, 'no cards')),
        Promise.all(c.boxes.map(async b => readItems(b.batch, await ask(b.call)))).then(v => v.flat()),
        c.placement ? ask(c.placement).then(a => readNotes(c.notes, a)) : Promise.resolve([]),
      ])
      return { slug: r.slug, run: r.run, key: r.key, result: r.result, needs, items, notes }
    }),
  )
  const fields = (await Promise.all(fieldBatches(runs).map(async b => readFields(b.batch, await ask(b.call))))).flat()
  return { stories, fields }
}

/**
 * Story context's pure checks (`.context/story-context.md`, "Checks"; ADR-0057's rule as amended for
 * every new step): a fact rendered as the check reads it, the fact and box items with their
 * evidence and number hints for research's own fact-check prompt, the verdicts applied, the
 * structural box checks, failed items and empty boxes dropped, and the item tally. It reuses
 * research's `checkCopying`, `sourceLines`, `judgedProblems`, `publishedFact` and `numberHints`.
 */
import { config } from '../config.js'
import type { CheckedItem } from '../prompts/research.js'
import type { FactCheck } from '../schemas/research.js'
import type {
  Approx,
  BoxesAnswer,
  BoxType,
  ContextSlot,
  CreditedKind,
  StoredChart,
  StoredSentence,
  StoredTile,
  StoredVisual,
  Validity,
  WrittenBox,
} from '../schemas/storyContext.js'
import {
  judgedProblems,
  numberHints,
  publishedFact,
  unjudgedLabels,
  type CheckedDraftItem,
  type CitationProblem,
  type DraftItem,
  type PoolFact,
} from './researchChecks.js'
import { checkCopying, type SourceLine, type WordingSource } from './researchCopying.js'
import { spelledFigure, tileDisplay, validChart, type ValidityWindows, type VisualFact } from './storyContextVisuals.js'

export type FactVerdict = 'supported' | 'rejected' | 'unjudged'

export interface FactSource {
  /** `S2`: research's id, or the next free number for a source this run found. */
  id: string
  url: string
  outlet: string
  title: string
  /** `YYYY-MM-DD`; null when unknown. */
  date: string | null
  /** `SOURCE_KINDS`. */
  kind: string
}

/** One context fact as the run holds it, before and after its check. */
export interface ContextFactData {
  /** `S2F3`: unique within the run, as boxes cite it. */
  ref: string
  origin: 'research' | 'search'
  /** The earlier story's fact a reused one stands for; null otherwise. */
  reusedFromId: string | null
  /** The slot a search fact was extracted for; null for research's. */
  slot: ContextSlot | null
  source: FactSource
  supportingSentence: string
  /** A search fact's sentence with one sentence either side; null for research's. */
  passage: string | null
  supportFound: boolean
  statement: string
  value: number | null
  valueHigh: number | null
  unit: string
  approx: Approx
  provisional: boolean
  counted: string
  place: string
  asOf: string | null
  credited: string
  creditedKind: CreditedKind | null
  validity: Validity
  verdict: FactVerdict
  verdictProblem: string | null
  model: string
  promptVersion: string
}

/** A box as the run writes it, citing its facts by ref. */
export interface DraftBox {
  type: BoxType
  heading: string
  teaser: string
  /** `P<n>`, `W<n>`, or null for the section. */
  place: string | null
  sentences: StoredSentence[]
  visual: StoredVisual | null
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** "November 14, 2026", "November 2026" or "2026". */
export function asOfWords(asOf: string): string {
  const [y, m, d] = asOf.split('-')
  const month = m ? MONTHS[Number(m) - 1] : undefined
  if (!month) return y!
  return d ? `${month} ${Number(d)}, ${y}` : `${month} ${y}`
}

const capitalized = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * A fact as the check judges it: with a figure, what it counts and the figure with its qualifier and
 * unit; then its place, its as-of date and who it is credited to, and "estimate" (or "provisional",
 * for a claim without a figure) where it applies. Without a figure, its statement with those details.
 */
export function renderFact(
  f: Pick<ContextFactData, 'statement' | 'value' | 'valueHigh' | 'unit' | 'approx' | 'provisional' | 'counted' | 'place' | 'asOf' | 'credited'>,
): string {
  const figure = spelledFigure(f)
  const main = figure !== null && f.counted.trim() ? `${capitalized(f.counted.trim())}: ${figure}` : f.statement.trim()
  const details = [
    f.place.trim() && !main.toLowerCase().includes(f.place.trim().toLowerCase()) ? `in ${f.place.trim()}` : '',
    f.asOf ? `as of ${asOfWords(f.asOf)}` : '',
    f.credited.trim() ? `according to ${f.credited.trim()}` : '',
  ].filter(Boolean)
  const flag = f.provisional ? (figure !== null ? ' (estimate)' : ' (provisional)') : ''
  if (figure !== null && f.counted.trim()) return `${[main, ...details].join(', ')}${flag}`
  const extra = [...(figure !== null ? [figure] : []), ...details]
  return `${main}${extra.length > 0 ? ` (${extra.join(', ')})` : ''}${flag}`
}

/** As the checks show a fact in a box item's evidence: rendered, with its source's words. */
const asEvidence = (f: ContextFactData): PoolFact => ({
  id: f.ref,
  statement: renderFact(f),
  supportingSentence: f.passage ?? f.supportingSentence,
  measures: f.counted,
})

const sourceDateFacts = (facts: ContextFactData[]): PoolFact[] => {
  const seen = new Map<string, ContextFactData>()
  for (const f of facts) if (!seen.has(f.source.id)) seen.set(f.source.id, f)
  return [...seen.values()].flatMap(f => publishedFact(f.source.id, f.source.outlet, f.source.date))
}

const cited = (label: string, text: string, factIds: string[]): DraftItem => ({ part: 'story', label, text, cited: true, factIds })

export const factLabel = (ref: string) => `Fact ${ref}`

/**
 * Each fact as an item of research's fact check: its rendered text, judged against its source's
 * words alone (the supporting sentence, or for a search fact the passage around it), plus its
 * source's date fact; the numbers the evidence lacks as hints, as research gives them.
 */
export function factCheckItems(facts: ContextFactData[]): CheckedDraftItem[] {
  return facts.map(f => {
    const text = renderFact(f)
    const evidence: PoolFact[] = [
      { id: f.ref, statement: '', supportingSentence: f.passage ?? f.supportingSentence, measures: '' },
      ...publishedFact(f.source.id, f.source.outlet, f.source.date),
    ]
    return { item: cited(factLabel(f.ref), text, [f.ref]), evidence, numberHints: numberHints(text, evidence) }
  })
}

/** The items as research's fact-check prompt takes them. */
export const promptItems = (items: CheckedDraftItem[]): CheckedItem[] =>
  items.map(c => ({ label: c.item.label, text: c.item.text, facts: c.evidence, numbersNotFound: c.numberHints }))

/** Each fact's verdict from the check's answer on its items: a problem rejects it, no answer leaves it unjudged. */
export function factVerdicts(answer: FactCheck, items: CheckedDraftItem[]): Map<string, { verdict: FactVerdict; problem: string | null }> {
  const problems = judgedProblems(answer, items, [])
  const unjudged = new Set(unjudgedLabels(answer, items))
  return new Map(
    items.map(({ item }) => {
      const problem = problems.find(p => p.label === item.label)
      const verdict: FactVerdict = unjudged.has(item.label) ? 'unjudged' : problem ? 'rejected' : 'supported'
      return [item.factIds[0]!, { verdict, problem: verdict === 'rejected' ? (problem?.problem ?? null) : null }]
    }),
  )
}

/** As the visual rules read a fact; `shown` once it is supported (demotion comes from its record). */
export const visualFact = (f: ContextFactData, shown = f.verdict === 'supported'): VisualFact => ({
  ref: f.ref,
  value: f.value,
  valueHigh: f.valueHigh,
  unit: f.unit,
  approx: f.approx,
  provisional: f.provisional,
  asOf: f.asOf,
  sourceDate: f.source.date,
  validity: f.validity,
  creditedKind: f.creditedKind,
  sourceKind: f.source.kind,
  shown,
})

export type BoxDropCause = 'structure' | 'expired' | 'undrawn' | 'check' | 'unjudged' | 'copying' | 'empty'

export interface BoxDrop {
  label: string
  cause: BoxDropCause
  problem?: string
}

export interface StructuralResult {
  boxes: DraftBox[]
  drops: BoxDrop[]
  /** Sentences, tiles and points dropped because they cite something other than a supported fact: failed items. */
  structural: number
}

const boxLabel = (b: number) => `Box ${b + 1}`

/** A place the story has (`P<n>`, `W<n>`), else null for the section. */
const knownPlace = (place: string, spots: ReadonlySet<string>) => (spots.has(place.trim()) ? place.trim() : null)

/** What the write may return (`config.storyContext`): boxes beside the figures box, sentences and tiles a box. */
export interface BoxCaps {
  boxes: number
  sentences: number
  tiles: number
}

const configCaps = (): BoxCaps => ({ boxes: config.storyContext.maxBoxes, sentences: config.storyContext.maxSentences, tiles: config.storyContext.maxTiles })

/** The written boxes the caps keep, in order: the first of each slot, at most `cap` of them; the others as drops. */
function cappedBoxes(written: WrittenBox[], cap: number, drops: BoxDrop[]): WrittenBox[] {
  const slots = new Set<string>()
  return written.filter(box => {
    const problem = slots.has(box.slot) ? 'a second box for its slot' : slots.size >= cap ? `over the ${cap} boxes` : null
    if (problem === null) {
      slots.add(box.slot)
      return true
    }
    drops.push({ label: `Box "${box.heading.trim()}"`, cause: 'structure', problem })
    return false
  })
}

/**
 * The write's answer as boxes, the structural checks applied (step 10): the caps first (the first
 * box of each slot, at most `caps.boxes` beside the figures box, at most `caps.sentences` sentences
 * and `caps.tiles` tiles a box, in the order written); then a sentence or tile citing nothing, or
 * anything but a supported fact, is dropped, as is a chart point; a place the story doesn't have
 * becomes the section, and the figures box always sits there. Every drop counts as structural.
 */
export function structuralBoxes(
  answer: BoxesAnswer,
  supported: ReadonlySet<string>,
  spots: ReadonlySet<string>,
  caps: BoxCaps = configCaps(),
): StructuralResult {
  const drops: BoxDrop[] = []
  const ok = (ids: string[]) => ids.length > 0 && ids.every(id => supported.has(id))
  /** The items within the cap whose citations hold, each other one a drop. */
  const keep = <T>(b: number, what: 'sentence' | 'tile', list: T[], cap: number, factIds: (item: T) => string[]) =>
    list.filter((item, j) => {
      const problem = j >= cap ? `over the ${cap} ${what}s` : ok(factIds(item)) ? null : 'cites no supported fact'
      if (problem === null) return true
      drops.push({ label: `${boxLabel(b)} ${what} ${j + 1}`, cause: 'structure', problem })
      return false
    })
  const written: { type: BoxType; heading: string; teaser: string; place: string | null; box: WrittenBox | null; tiles: StoredTile[] }[] = [
    ...(answer.figures
      ? [{ type: 'figures' as const, heading: answer.figures.heading, teaser: answer.figures.teaser, place: null, box: null, tiles: answer.figures.tiles }]
      : []),
    ...cappedBoxes(answer.boxes, caps.boxes, drops).map(box => ({
      type: box.slot,
      heading: box.heading,
      teaser: box.teaser,
      place: knownPlace(box.place, spots),
      box,
      tiles: box.visual.tiles,
    })),
  ]
  const boxes = written.map((w, b): DraftBox => {
    const sentences = keep(b, 'sentence', w.box?.sentences ?? [], caps.sentences, s => s.factIds)
    let visual: StoredVisual | null = null
    const kind = w.box ? w.box.visual.kind : 'tiles'
    if (kind === 'tiles') {
      const tiles = keep(b, 'tile', w.tiles, caps.tiles, t => t.factIds)
      visual = tiles.length > 0 ? { kind: 'tiles', tiles } : null
    } else if (kind === 'bars' || kind === 'line') {
      const v = w.box!.visual
      const points = (list: StoredChart['points'], what: string) =>
        list.filter((p, j) => {
          if (supported.has(p.factId)) return true
          drops.push({ label: `${boxLabel(b)} ${what} point ${j + 1}`, cause: 'structure', problem: 'cites no supported fact' })
          return false
        })
      visual = {
        kind,
        measure: v.measure,
        unit: v.unit,
        points: points(v.points, 'chart'),
        apart: kind === 'bars' && v.apart ? { ...v.apart, points: points(v.apart.points, 'apart') } : null,
      }
    }
    return { type: w.type, heading: w.heading.trim(), teaser: w.teaser.trim(), place: w.type === 'figures' ? null : w.place, sentences, visual }
  })
  return { boxes, drops, structural: drops.length }
}

/**
 * The visuals as they would be shown (steps 10's last rules): a tile none of whose facts is current
 * is dropped, a chart that breaks the chart rules is not drawn (its box keeps its sentences); neither
 * counts as a failure.
 */
export function resolveVisuals(
  boxes: DraftBox[],
  facts: ReadonlyMap<string, ContextFactData>,
  storyDay: string,
  windows: ValidityWindows,
): { boxes: DraftBox[]; drops: BoxDrop[] } {
  const visuals = new Map([...facts.values()].map(f => [f.ref, visualFact(f)]))
  const drops: BoxDrop[] = []
  const out = boxes.map((box, b): DraftBox => {
    const v = box.visual
    if (!v) return box
    if (v.kind === 'tiles') {
      const tiles = v.tiles.filter((t, j) => {
        if (
          tileDisplay(
            t.factIds.flatMap(id => visuals.get(id) ?? []),
            storyDay,
            windows,
          ).length > 0
        )
          return true
        drops.push({ label: `${boxLabel(b)} tile ${j + 1}`, cause: 'expired' })
        return false
      })
      return { ...box, visual: tiles.length > 0 ? { kind: 'tiles', tiles } : null }
    }
    const chart = validChart(v, visuals, storyDay)
    if (!chart) {
      drops.push({ label: `${boxLabel(b)} chart`, cause: 'undrawn' })
      return { ...box, visual: null }
    }
    // Keep only what is drawn, so the check judges the chart a reader would see
    const drawn = new Set(chart.points.map(p => p.ref))
    const apartDrawn = new Set(chart.apart?.points.map(p => p.ref) ?? [])
    return {
      ...box,
      visual: {
        ...v,
        points: v.points.filter(p => drawn.has(p.factId)),
        apart: chart.apart && v.apart ? { ...v.apart, points: v.apart.points.filter(p => apartDrawn.has(p.factId)) } : null,
      },
    }
  })
  return { boxes: out, drops }
}

export type BoxItemKind = 'sentence' | 'tile' | 'chart' | 'apart'

export interface BoxItem {
  box: number
  kind: BoxItemKind
  /** The sentence's or tile's index in its box; 0 for a chart and its apart group. */
  index: number
  checked: CheckedDraftItem
}

const chartText = (measure: string, unit: string, points: StoredChart['points'], facts: ReadonlyMap<string, ContextFactData>) =>
  `${[measure, unit].filter(s => s.trim()).join(', ')}: ${points
    .map(p => {
      const f = facts.get(p.factId)!
      return `${p.label}, ${spelledFigure({ ...f, unit: '' })}${f.provisional ? ' (estimate)' : ''}`
    })
    .join('; ')}`

/**
 * Every sentence, tile and chart of the boxes as an item of research's fact check, against its cited
 * facts (rendered, with their sources' words and dates): a tile as it is shown ("people under
 * hazardous smoke, Southeast Asia: 12.5 million"), a chart with each point ("area burned in Indonesia,
 * hectares: 2015, 2.6 million; 2026, 2.88 million (estimate)"), so the check judges that every
 * point measures what the chart says. Boxes and their visuals must have been resolved first.
 */
export function boxCheckItems(boxes: DraftBox[], facts: ReadonlyMap<string, ContextFactData>, storyDay: string, windows: ValidityWindows): BoxItem[] {
  const visuals = new Map([...facts.values()].map(f => [f.ref, visualFact(f)]))
  const item = (box: number, kind: BoxItemKind, index: number, label: string, text: string, factIds: string[]): BoxItem => {
    const citedFacts = factIds.flatMap(id => facts.get(id) ?? [])
    const evidence = [...citedFacts.map(asEvidence), ...sourceDateFacts(citedFacts)]
    return { box, kind, index, checked: { item: cited(label, text, factIds), evidence, numberHints: numberHints(text, evidence) } }
  }
  return boxes.flatMap((box, b) => {
    const items = box.sentences.map((s, j) => item(b, 'sentence', j, `${boxLabel(b)} sentence ${j + 1}`, s.text, s.factIds))
    const v = box.visual
    if (v?.kind === 'tiles') {
      v.tiles.forEach((t, j) => {
        const shown = tileDisplay(
          t.factIds.flatMap(id => visuals.get(id) ?? []),
          storyDay,
          windows,
        )
        const values = shown.map(s => {
          const f = facts.get(s.ref)!
          return `${spelledFigure(f)}${f.provisional ? ' (estimate)' : ''}`
        })
        items.push(
          item(
            b,
            'tile',
            j,
            `${boxLabel(b)} tile ${j + 1}`,
            `${t.label}: ${values.join('; ')}`,
            shown.map(s => s.ref),
          ),
        )
      })
    } else if (v) {
      items.push(
        item(
          b,
          'chart',
          0,
          `${boxLabel(b)} chart`,
          chartText(v.measure, v.unit, v.points, facts),
          v.points.map(p => p.factId),
        ),
      )
      if (v.apart)
        items.push(
          item(
            b,
            'apart',
            0,
            `${boxLabel(b)} apart`,
            chartText(v.apart.measure, v.apart.unit, v.apart.points, facts),
            v.apart.points.map(p => p.factId),
          ),
        )
    }
    return items
  })
}

/** Each source's words, as the copying checks compare against them: its title and its facts' sentences and statements, and research's voices. */
export function wordingSources(facts: ContextFactData[], voices: ReadonlyMap<string, WordingSource['voices']>): WordingSource[] {
  const bySource = new Map<string, WordingSource>()
  for (const f of facts) {
    const s = bySource.get(f.source.id) ?? { id: f.source.id, title: f.source.title, facts: [], voices: voices.get(f.source.id) ?? [] }
    s.facts.push({ id: f.ref, statement: f.statement, supportingSentence: f.supportingSentence })
    bySource.set(f.source.id, s)
  }
  return [...bySource.values()]
}

export interface BoxVerdicts {
  boxes: DraftBox[]
  drops: BoxDrop[]
  /** Items the check judged, and those of them it failed or left out. */
  judged: number
  failed: number
}

/**
 * The box check's answers applied (step 11): an item the check fails for support or copying, one the
 * code's copying check flags, and one the answer leaves out are dropped; a chart dropped takes its
 * apart group with it; a box left with nothing in it is dropped. No repair rounds.
 */
export function applyBoxVerdicts(
  boxes: DraftBox[],
  items: BoxItem[],
  answers: { answer: FactCheck; items: BoxItem[] }[],
  lines: SourceLine[],
  copying: CitationProblem[],
): BoxVerdicts {
  const failing = new Map<string, BoxDrop>()
  for (const { answer, items: batch } of answers) {
    const checked = batch.map(i => i.checked)
    for (const p of judgedProblems(answer, checked, lines))
      if (!failing.has(p.label)) failing.set(p.label, { label: p.label, cause: p.kind === 'copying' ? 'copying' : 'check', problem: p.problem })
    for (const label of unjudgedLabels(answer, checked)) if (!failing.has(label)) failing.set(label, { label, cause: 'unjudged' })
  }
  for (const p of copying) if (!failing.has(p.label)) failing.set(p.label, { label: p.label, cause: 'copying', problem: p.problem })

  const fails = (i: BoxItem) => failing.has(i.checked.item.label)
  const drops = [...failing.values()]
  const kept = boxes.flatMap((box, b): DraftBox[] => {
    const mine = items.filter(i => i.box === b)
    const failed = (kind: BoxItemKind, index: number) => mine.some(i => i.kind === kind && i.index === index && fails(i))
    const sentences = box.sentences.filter((_, j) => !failed('sentence', j))
    let visual = box.visual
    if (visual?.kind === 'tiles') {
      const tiles = visual.tiles.filter((_, j) => !failed('tile', j))
      visual = tiles.length > 0 ? { kind: 'tiles', tiles } : null
    } else if (visual) {
      visual = failed('chart', 0) ? null : { ...visual, apart: failed('apart', 0) ? null : visual.apart }
    }
    if (sentences.length === 0 && visual === null) {
      drops.push({ label: boxLabel(b), cause: 'empty' })
      return []
    }
    return [{ ...box, sentences, visual }]
  })
  return { boxes: kept, drops, judged: items.length, failed: items.filter(fails).length }
}

/** The code's copying check on the box sentences (12 words in a row, `config.research.copiedRunWords`). */
export function boxCopying(boxes: DraftBox[], sources: WordingSource[], minWords: number): CitationProblem[] {
  const items = boxes.flatMap((box, b) => box.sentences.map((s, j) => cited(`${boxLabel(b)} sentence ${j + 1}`, s.text, s.factIds)))
  return checkCopying(items, sources, minWords).problems
}

export interface TallyInput {
  /** Facts the fact check was asked about, by verdict. */
  supported: number
  rejected: number
  unjudged: number
  /** Research facts the structure step left out, and search facts dropped for their structure. */
  leftOut: number
  /** Box items dropped by the structural checks. */
  boxStructural: number
  /** Box items the box check was asked about, and those that failed it or its copying checks, or went unanswered. */
  boxJudged: number
  boxFailed: number
}

/**
 * The failure share's tally: every fact judged or left out, and every box item checked, in code or
 * by the model; failed are the facts rejected, unjudged or left out and the box items a check
 * dropped. Charts not drawn under the rules and expired tiles count for nothing.
 */
export function itemTally(t: TallyInput): { checked: number; failed: number } {
  return {
    checked: t.supported + t.rejected + t.unjudged + t.leftOut + t.boxStructural + t.boxJudged,
    failed: t.rejected + t.unjudged + t.leftOut + t.boxStructural + t.boxFailed,
  }
}

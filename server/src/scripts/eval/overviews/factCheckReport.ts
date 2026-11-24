/**
 * The fact check's report section (`factCheck.ts`, `factCheckScore.ts`): the sample, the label pass,
 * the variants built from the accepted facts, each arm against the bars with its misses and false
 * rejections, and the facts the label pass rejected. For a sample of rendered module-1 facts that
 * last part is the measure of the rendering (`scoreFidelity`): the two report-only faithful shares,
 * each group's counts, the label pass's own share, the changed facts by kind, then every fact the
 * second pass (`factDrift.ts`) found changed or left unjudged, those with a figure first; the facts
 * it found lacking only context are counted, never listed. Where the second pass did not run, why,
 * and every fact the label pass rejected. Pure.
 */
import { pct } from '../checks.js'
import { armKey } from '../models.js'
import { OVERVIEW_FACT_SOURCES } from '../options.js'
import { LABEL_ARM, type CheckItem, type Labels, type Verdict } from './factCheck.js'
import { CATCH_BAR, FALSE_REJECTION_BAR, MAX_LISTED, type ArmScore, type Fidelity, type FidelityGroup, type Listed } from './factCheckScore.js'
import { sampledFacts, type FactSample } from './factSources.js'
import { rows } from './linkReport.js'
import { expectedSupported, FIELD_KINDS, VARIANT_KINDS, type VariantKind } from './plant.js'
import { cell, metText, quoted, spreadText } from './reportText.js'

export interface FactCheckReport {
  sample: FactSample
  /** Facts the strong judge labeled: the sample, or its first `--limit` on a smoke run. */
  labeled: number
  labels: Labels
  /** The variants built from the accepted facts, for the arms to judge. */
  variants: CheckItem[]
  limit?: number
  scores: ArmScore[]
  /** Why the arms did not run once the labels were known (the budget, or the API key); absent when they ran. */
  stoppedArms?: string
  /** Why the second pass did not run (the budget, or the API key); absent when it ran or was not due. */
  stoppedDrift?: string
  /** The two strong-judge passes as a measure of the rendering; only for a sample of rendered module-1 facts. */
  fidelity?: Fidelity
}

const counted = (values: string[]) => {
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
}

const listedLine = (l: Listed) =>
  `- ${l.kind}: ${quoted(l.text)}${l.change ? ` (${cell(l.change)})` : ''}; sentence ${quoted(l.sentence)} (${cell(l.outlet)})${l.runs > 1 ? `; in ${l.times} of ${l.runs} runs` : ''}`

/**
 * On the stands' lines the false-rejection bar is report only (the owner, 2026-11-24): a correct line
 * wrongly rejected is a sentence readers do not get, never a wrong one they do, and the check is
 * research's, already in use. Research's and context's own samples keep the bar.
 */
const STANDS_FALSE_REJECTION = 'report only on the stands (a correct line dropped, never a wrong one shown)'

function armLines(s: ArmScore, kinds: readonly VariantKind[], reportOnlyFalseRejection = false): string[] {
  return [
    `### ${s.arm}`,
    '',
    `${s.runs} run${s.runs === 1 ? '' : 's'}; rates pool every run.`,
    '',
    '| Kind | Expected | Items | Verdicts | Judged unsupported | Share |',
    '|---|---|---|---|---|---|',
    ...s.perKind.filter(k => kinds.includes(k.kind)).map(k => `| ${k.kind} | ${k.expected} | ${k.items} | ${k.judged} | ${k.unsupported} | ${pct(k.rate)} |`),
    '',
    `- **Catch rate** (planted errors judged unsupported): ${pct(s.catchRate)}; bar at least ${pct(CATCH_BAR)}: ${metText(s.catchMet)}.`,
    `- **False rejection** (faithful and reworded judged unsupported): ${pct(s.falseRejection)}; bar at most ${pct(FALSE_REJECTION_BAR)}: ${reportOnlyFalseRejection ? STANDS_FALSE_REJECTION : metText(s.falseRejectionMet)}.`,
    `- **Unjudged:** ${s.unjudged} verdicts missing (no entry in the answer, a failed call, or the budget).`,
    ...(s.spread
      ? [
          `- **Across runs:** catch rate ${spreadText(s.spread.catchRate)}; false rejection ${spreadText(s.spread.falseRejection)}.`,
          `- **Flips:** the verdict differs between runs for ${s.flips?.differing ?? 0} of ${s.flips?.stories ?? 0} items judged in every run (${pct(s.flips?.share)}).`,
        ]
      : []),
    '',
    `#### Misses (${s.misses.length} of ${s.missCount})`,
    '',
    ...(s.misses.length > 0 ? s.misses.map(listedLine) : ['None.']),
    '',
    `#### False rejections (${s.falseRejections.length} of ${s.falseRejectionCount})`,
    '',
    ...(s.falseRejections.length > 0 ? s.falseRejections.map(listedLine) : ['None.']),
    '',
  ]
}

function sampleLines(sample: FactSample): string[] {
  const facts = sampledFacts(sample)
  const outlets = new Set(facts.map(f => f.outlet)).size
  const stories = new Set(facts.map(f => f.storyId ?? f.runId)).size
  const undated = facts.filter(f => f.date === null).length
  if (sample.source === 'context' || sample.source === 'pool') {
    const c = sample.facts
    const opening =
      sample.source === 'context'
        ? `**Sample (module-1 facts, \`--facts context\`):** ${facts.length} facts (of ${c.size} asked for) that production's check supported in the context step's run 1`
        : `**Sample (a first pass's pool facts, \`--facts pool\`):** ${facts.length} facts (of ${c.size} asked for) that production's check supported in the pass-pool step's first passes`
    return [
      `${opening}, none reused, from ${stories} stories (half ${sample.half}) and ${outlets} outlets; ${undated} facts from sources without a date. Each is checked as production's \`renderFact\` renders it, its statement and then its record; the text kinds are planted in the statement and the field kinds change one field of the record, each rendered again.`,
      ...c.shortfalls.map(s => `- Shortfall: ${s}`),
    ]
  }
  if (sample.source === 'stands') {
    const c = sample.facts
    return [
      `**Sample (stands lines, \`--facts stands\`):** ${facts.length} lines (of ${c.size} asked for) the stands step's run 1 kept, from ${stories} developments (half ${sample.half}); each is checked against its cited facts' source sentences, with the text kinds planted in it.`,
      ...c.shortfalls.map(s => `- Shortfall: ${s}`),
    ]
  }
  const fx = sample.fixtures
  const languages = counted(facts.map(f => f.language ?? 'unknown'))
  return [
    `**Sample:** ${facts.length} facts (of ${fx.size} asked for) from ${stories} stories and ${outlets} outlets, ${fx.runsRead} runs read back from the newest (${fx.anchor ?? 'none'}), ${fx.olderShape} of them skipped as stored in an older shape; ${undated} facts from sources without a date. Languages: ${languages.map(([l, n]) => `${l} ${n}`).join(', ') || 'none'}.`,
    ...fx.shortfalls.map(s => `- Shortfall: ${s}`),
  ]
}

/** A fact as it was shown, its evidence, and the reason a judge gave, behind the kind of change where there is one. */
const factLine = (v: Verdict, reason: string, kind?: string) =>
  `- ${kind ? `${kind}: ` : ''}${quoted(v.item.text)}; sentence ${quoted(v.item.fact.sentence)}${v.item.fact.measures ? `; measures ${quoted(v.item.fact.measures)}` : ''} (${cell(v.item.fact.outlet)}): ${cell(reason) || 'no reason given'}`

/** A fact the label pass rejected, with that judge's reason. */
const rejectedLine = (v: Verdict) => factLine(v, v.problem)

/** The statements the label pass rejected, the first `MAX_LISTED`: for a sample of statements or lines, which the label pass does not measure. */
function rejectedLines(unsupported: Verdict[]): string[] {
  return [
    `### Statements their evidence does not support (sentence, what it measures, source date): ${Math.min(unsupported.length, MAX_LISTED)} of ${unsupported.length}`,
    '',
    "Not an extraction-fidelity measure: the judge never sees the source's full text, so a statement that rightly carries scope or period from elsewhere in the article lands here too.",
    '',
    ...(unsupported.length > 0 ? unsupported.slice(0, MAX_LISTED).map(rejectedLine) : ['None.']),
  ]
}

/** A `####` list of facts, its count in the heading; `None.` when it is empty. */
const factList = (heading: string, lines: string[]) => [`#### ${heading} (${lines.length})`, '', ...(lines.length > 0 ? lines : ['None.'])]

/** The second pass's sorting, for the shares' measure: what each group's faithful share counts and what it leaves out. */
function faithfulLines(f: Fidelity): string[] {
  const counts = (name: string, g: FidelityGroup) =>
    `- ${name}: ${g.faithful} of ${g.judged} judged facts faithful (${g.accepted} the label pass accepted, ${g.context} it rejected only for context the sentence lacks); ${g.changed.length} changed; ${g.unjudged.length} the second pass left unjudged; ${g.unlabeled} without a verdict.`
  const changed = (g: FidelityGroup) => g.changed.map(r => factLine(r.rejection, r.reason, r.kind ?? undefined))
  const unjudged = [...f.withFigure.unjudged, ...f.withoutFigure.unjudged].map(r => rejectedLine(r.rejection))
  return [
    counts('With a figure', f.withFigure),
    counts('Without a figure', f.withoutFigure),
    `- The label pass alone: with a figure ${f.withFigure.accepted} of ${f.withFigure.judged} accepted (${pct(f.withFigure.acceptedShare)}); without a figure ${f.withoutFigure.accepted} of ${f.withoutFigure.judged} (${pct(f.withoutFigure.acceptedShare)}).`,
    '',
    '| Changed, by kind | With a figure | Without a figure |',
    '|---|---|---|',
    ...f.changedByKind.map(k => `| ${k.kind} | ${k.withFigure} | ${k.withoutFigure} |`),
    '',
    ...factList('Facts with a figure the second pass found changed', changed(f.withFigure)),
    '',
    ...factList('Facts without a figure the second pass found changed', changed(f.withoutFigure)),
    ...(unjudged.length > 0 ? ['', `#### Facts the second pass left unjudged (${unjudged.length}), counted as not faithful`, '', ...unjudged] : []),
  ]
}

/** The label pass alone, where the second pass did not run: each group's counts, then every fact it rejected. */
function labelOnlyLines(f: Fidelity): string[] {
  const counts = (name: string, g: FidelityGroup) =>
    `- ${name}: ${g.accepted} of ${g.judged} judged facts accepted by the label pass; ${g.unlabeled} without a verdict.`
  return [
    counts('With a figure', f.withFigure),
    counts('Without a figure', f.withoutFigure),
    '',
    ...factList('Facts with a figure the label pass rejected', f.withFigure.rejected.map(rejectedLine)),
    '',
    ...factList('Facts without a figure the label pass rejected', f.withoutFigure.rejected.map(rejectedLine)),
  ]
}

/**
 * The two strong-judge passes read as a measure of the rendering (`scoreFidelity`): the two
 * report-only faithful shares, then the second pass's sorting (`faithfulLines`), or, where it did
 * not run, why and the label pass alone (`labelOnlyLines`). No cap on the lists: they are what the
 * shares are read with, and they cannot be printed again once the rendering changes.
 */
function fidelityLines(f: Fidelity, stoppedDrift: string | undefined): string[] {
  const ran = f.withFigure.faithful !== null
  return [
    '### The facts as rendered against their sources (report only)',
    '',
    `What the fact check's two strong-judge passes say about the facts themselves, before any error is planted: each sampled fact as production's \`renderFact\` shows it to writers and checks, judged by ${armKey(LABEL_ARM)} against its source's sentence or passage and the source's date. The sample is facts production's own check supported, none reused, so this is what writers are shown. Every fact is shown as its statement, then its record of fields in square brackets (figure, what it counts, place, as-of date, credit, estimate or provisional), and the statement and each field are judged alike. The label pass sees one sentence or passage of the source, so it also rejects a fact that only names the subject, place, body or person the rest of the article supplies. A second pass by the same judge, once, reads each fact it rejected again, with the source's headline and our story's title, and sorts it: lacking only context, or changed (a figure or thing counted the source does not give, a proposal or possibility stated as fact, a period or condition dropped, a credit the source does not give, an estimate mark it does not warrant, a placeholder in a field). A fact is faithful when the label pass accepted it or the second pass found it lacking only context; a fact the second pass left unanswered counts as not faithful. Neither pass sees the source's full text: the second trusts the source's headline and our story's title for the context it cannot check, so a wrong place or body that fits them passes as context, and a credit the article gives outside the sentence counts as changed. Read the shares with the changed facts, every one listed below with its kind and the judge's reason.`,
    '',
    ...(ran
      ? []
      : [
          `The second pass did not run: ${cell(stoppedDrift ?? 'no reason recorded')}. The faithful shares are unknown until it does; what follows is the label pass alone.`,
          '',
        ]),
    '| Measure | Reference | Share | Verdict |',
    '|---|---|---|---|',
    ...rows(f.bars),
    '',
    ...(ran ? faithfulLines(f) : labelOnlyLines(f)),
  ]
}

export function factCheckLines(r: FactCheckReport): string[] {
  const unsupported = r.labels.unsupported
  /** Module-1 facts as `renderFact` renders them; research's statements and the stands' lines carry no structured fields to change. */
  const rendered = OVERVIEW_FACT_SOURCES[r.sample.source].rendered
  const kinds = rendered ? VARIANT_KINDS : VARIANT_KINDS.filter(k => !(FIELD_KINDS as readonly string[]).includes(k))
  const shape = rendered
    ? "as rendered against their evidence (the source's sentence or passage, the source's date)"
    : "as extracted against their evidence (the source's sentence, what the fact measures, the source's date)"
  return [
    ...sampleLines(r.sample),
    '',
    `**Labels:** ${armKey(LABEL_ARM)} judged ${r.labeled} facts${r.limit !== undefined ? ` (the first ${r.limit} of the sample, --limit: a smoke run, not evidence)` : ''} ${shape}: ${r.labels.accepted.length} accepted, ${unsupported.length} statements their evidence does not support (${pct(r.labeled === 0 ? null : unsupported.length / r.labeled)}), ${r.labels.unlabeled.length} without a verdict. Variants are built from the accepted facts only.`,
    '',
    '| Kind | Expected | Variants |',
    '|---|---|---|',
    ...kinds.map(kind => `| ${kind} | ${expectedSupported(kind) ? 'supported' : 'unsupported'} | ${r.variants.filter(v => v.kind === kind).length} |`),
    '',
    ...(r.stoppedArms ? [`No arm ran: ${cell(r.stoppedArms)}.`, ''] : []),
    ...r.scores.flatMap(s => armLines(s, kinds, r.sample.source === 'stands')),
    // The rejected facts close the section: as the rendering's measure where it was scored, else the capped list
    ...(r.fidelity ? fidelityLines(r.fidelity, r.stoppedDrift) : rejectedLines(unsupported)),
  ]
}

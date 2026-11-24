/**
 * The fact check's report section (`factCheck.ts`, `factCheckScore.ts`): the sample, the label pass,
 * the variants built from the accepted facts, each arm against the bars with its misses and false
 * rejections, and the facts the label pass rejected. For a sample of rendered module-1 facts that
 * last part is the label pass read as a measure of the rendering (`scoreFidelity`): its two
 * report-only shares, then every rejected fact, those with a figure first. Pure.
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
  /** The label pass as a measure of the rendering; only for a sample of rendered module-1 facts. */
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
      `${opening}, none reused, from ${stories} stories (half ${sample.half}) and ${outlets} outlets; ${undated} facts from sources without a date. Each is checked as production's \`renderFact\` renders it; the field kinds change one structured field before it is rendered again.`,
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

/** A fact the label pass rejected: as it was shown, its evidence, and the judge's reason. */
const rejectedLine = (v: Verdict) =>
  `- ${quoted(v.item.text)}; sentence ${quoted(v.item.fact.sentence)}${v.item.fact.measures ? `; measures ${quoted(v.item.fact.measures)}` : ''} (${cell(v.item.fact.outlet)}): ${cell(v.problem) || 'no reason given'}`

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

/**
 * The label pass read as a measure of the rendering (`scoreFidelity`): its two report-only bars, each
 * group's counts, then every fact the judge rejected, those with a figure first. No cap: the list is
 * what the shares are read with, and it cannot be printed again once the rendering changes.
 */
function fidelityLines(f: Fidelity): string[] {
  const counts = (name: string, g: FidelityGroup) => `- ${name}: ${g.accepted} of ${g.judged} judged facts accepted; ${g.unlabeled} without a verdict.`
  const rejected = (name: string, g: FidelityGroup) => [
    `#### Facts ${name} the judge rejected (${g.rejected.length})`,
    '',
    ...(g.rejected.length > 0 ? g.rejected.map(rejectedLine) : ['None.']),
  ]
  return [
    '### The facts as rendered against their sources (report only)',
    '',
    `What the label pass says about the facts themselves, before any error is planted: each sampled fact as production's \`renderFact\` shows it to writers and checks, judged by ${armKey(LABEL_ARM)} against its source's sentence or passage and the source's date. The sample is facts production's own check supported, none reused, so this is what writers are shown. A fact with a figure is shown from its fields alone where it names what the figure counts, and as its statement with the figure beside it where it does not. The judge never sees the source's full text, so a fact that rightly carries scope or a period from elsewhere in the article counts against the share too: read the shares with the rejected facts, every one listed below with the judge's reason.`,
    '',
    '| Measure | Reference | Share | Verdict |',
    '|---|---|---|---|',
    ...rows(f.bars),
    '',
    counts('With a figure', f.withFigure),
    counts('Without a figure', f.withoutFigure),
    '',
    ...rejected('with a figure', f.withFigure),
    '',
    ...rejected('without a figure', f.withoutFigure),
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
    ...(r.fidelity ? fidelityLines(r.fidelity) : rejectedLines(unsupported)),
  ]
}

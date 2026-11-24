/**
 * The figure check's report section (`figureCheck.ts`, `figureCheckScore.ts`): the sample; where the
 * label pass did not run, why, and nothing more; else the labels, production's answers on the real
 * figures against them with every disagreement listed (to the cap), the variants built from the kept
 * figures the judge found given, why no arm ran where the budget stopped them, and each arm against
 * the bars with its misses and false removals. Pure.
 */
import { pct } from '../checks.js'
import { armKey } from '../models.js'
import { OVERVIEW_FACT_SOURCES } from '../options.js'
import { LABEL_ARM } from './factCheck.js'
import type { Answered, FigureCheckResult, FigureFixture, FigureShown } from './figureCheck.js'
import type { FigureAgreement, FigureArmScore, ListedVariant, ProductionGroup } from './figureCheckScore.js'
import { rows } from './linkReport.js'
import { expectedGiven, FIGURE_KINDS } from './plant.js'
import { cell, quoted } from './reportText.js'

/** A figure as the check was shown it: the number, what it counts, the source's words. */
const shownText = (s: FigureShown) => `${quoted(s.number)}, counts ${quoted(s.counts)}, source ${quoted(s.source)}`

function sampleLines(r: FigureCheckResult): string[] {
  const kept = r.sample.figures.filter(f => f.kept).length
  const step = OVERVIEW_FACT_SOURCES[r.source].step
  return [
    `**Sample (\`--facts ${r.source}\`):** ${r.sample.figures.length} figures (of ${r.sample.size} asked for) of the ${step} step's run 1, from ${r.sample.stories} stories (half ${r.half}), taken in turn from each story: ${kept} that production's figure check kept (none reused, whatever the fact check then said) and ${r.sample.figures.length - kept} that it removed. Each is shown as production showed it: the figure as spelled, what it counts, and its source's words, named by its place in the call.`,
    ...r.sample.shortfalls.map(s => `- Shortfall: ${s}`),
  ]
}

/** A real figure the judge disagrees with production on, with both answers. */
const disagreementLine = ({ item, answer }: Answered<FigureFixture>) =>
  `- ${shownText(item.shown)} (${cell(item.outlet)}): production ${item.kept ? 'kept it' : `removed it as ${item.answer}`}; the judge answered ${answer ?? 'nothing'}`

const groupList = (heading: string, g: ProductionGroup) => [
  `#### ${heading} (${g.listed.length} of ${g.disagreed})`,
  '',
  ...(g.listed.length > 0 ? g.listed.map(disagreementLine) : ['None.']),
]

function agreementLines(a: FigureAgreement, labeled: number, limit: number | undefined): string[] {
  const row = (name: string, g: ProductionGroup) =>
    `| ${name} | ${g.labeled + g.unlabeled} | ${g.labeled} | ${g.disagreed} | ${pct(g.share)} | ${g.unlabeled} |`
  return [
    `**Labels:** ${armKey(LABEL_ARM)} answered production's own prompt and schema on ${labeled} figures${limit !== undefined ? ` (the first ${limit} of the sample, --limit: a smoke run, not evidence)` : ''}, once. Its answers on the real figures are the only measure of a figure worked out or invented, which no rule can plant. Report only: the owner sets the bars after the first measurement.`,
    '',
    '| Production | Figures | Judge answered | Judge disagrees | Share | Without an answer |',
    '|---|---|---|---|---|---|',
    row('kept (the judge finds not given: drift that got through)', a.kept),
    row('removed (the judge finds given: false removals)', a.removed),
    '',
    ...groupList('Kept figures the judge finds not given', a.kept),
    '',
    ...groupList('Removed figures the judge finds given', a.removed),
  ]
}

const listedLine = (l: ListedVariant) =>
  `- ${l.variant.kind}: ${shownText(l.variant.shown)}${l.variant.change ? ` (${cell(l.variant.change)})` : ''} (${cell(l.variant.figure.outlet)}); answered ${l.answers.map(a => a ?? 'nothing').join(', ')}`

function armLines(s: FigureArmScore): string[] {
  return [
    `### ${s.arm}`,
    '',
    `${s.runs} run${s.runs === 1 ? '' : 's'}; shares pool every run.`,
    '',
    '| Kind | Expected | Variants | Answers | Not given | Share |',
    '|---|---|---|---|---|---|',
    ...s.perKind.map(k => `| ${k.kind} | ${k.expected} | ${k.items} | ${k.answered} | ${k.notGiven} | ${pct(k.share)} |`),
    '',
    `- **Unjudged:** ${s.unjudged} answers missing (no entry in the answer, or a failed call), counted in no share.`,
    '',
    `#### Misses: planted errors answered given (${s.misses.length} of ${s.missCount})`,
    '',
    ...(s.misses.length > 0 ? s.misses.map(listedLine) : ['None.']),
    '',
    `#### False removals: figures as they are answered not given (${s.falseRemovals.length} of ${s.falseRemovalCount})`,
    '',
    ...(s.falseRemovals.length > 0 ? s.falseRemovals.map(listedLine) : ['None.']),
    '',
  ]
}

export function figureCheckLines(r: FigureCheckResult): string[] {
  if (!r.labels || !r.score.agreement) return [...sampleLines(r), '', `The label pass did not run: ${cell(r.stopped?.reason ?? 'no reason recorded')}.`]
  return [
    ...sampleLines(r),
    '',
    ...agreementLines(r.score.agreement, r.labeled, r.limit),
    '',
    '| Kind | Expected | Variants |',
    '|---|---|---|',
    ...FIGURE_KINDS.map(kind => `| ${kind} | ${expectedGiven(kind) ? 'given' : 'not given'} | ${r.variants.filter(v => v.kind === kind).length} |`),
    '',
    ...(r.stopped?.pass === 'arms' ? [`No arm ran: ${cell(r.stopped.reason)}.`, ''] : []),
    ...(r.score.arms.length > 0
      ? [
          'Variants are built from the kept figures the judge found given: the figure as it is, a wrong number (the value times 1.5 at its precision, or 2), and another thing the story counts.',
          '',
          '| Bar | Reference | Share | Verdict |',
          '|---|---|---|---|',
          ...rows(r.score.bars),
          '',
          ...r.score.arms.flatMap(armLines),
        ]
      : []),
  ]
}

/**
 * Renders `recalibration-<half>.md`: per step, the owner's acceptance
 * criteria with value, bar and result, the evidence behind them, and what the
 * tested arm costs per call and per month.
 */
import type { Fixtures } from './fixtures.js'
import { accepted, type Criterion } from './recalibration.js'
import type { StepSection } from './recalibrationChecks.js'
import type { Half } from './sampling.js'

export interface RecalibrationReportInput {
  generatedAt: string
  half: Half | 'all'
  fixtures: Pick<Fixtures, 'createdAt' | 'anchor' | 'floor'>
  limit?: number
  sections: StepSection[]
  skipped: { step: string; reason: string }[]
  thisRunUsd: number
  ledgerUsd: number
  budgetUsd: number
}

const usd = (v: number) => `$${v < 1 ? v.toFixed(3) : v.toFixed(2)}`
const usdPerCall = (v: number) => `$${v < 0.01 ? v.toFixed(5) : v.toFixed(4)}`

/** A step without criteria (the rating set) either ran or threw. */
export function verdict(criteria: Criterion[]): string {
  if (criteria.length === 0) return 'done'
  if (accepted(criteria)) return 'accepted'
  return `not accepted (fails: ${criteria.filter(c => c.required && !c.pass).map(c => c.name).join(', ')})`
}

const result = (c: Criterion) => (c.pass ? 'pass' : c.required ? '**FAIL**' : 'missed (not required)')

function sectionLines(s: StepSection): string[] {
  const calls = s.stats.map(st =>
    `${st.arm}: ${st.calls} calls (${st.outcomes.ok} ok), p50 ${st.latencyP50 ?? 'n/a'} ms, ${usdPerCall(st.meanCostUsd)}/call, ${usd(st.totalCostUsd)} in total`)
  return [
    `## ${s.title}, ${s.arm}: ${verdict(s.criteria)}`,
    '',
    `Sample: ${s.sample}.`,
    '',
    ...(s.criteria.length > 0
      ? ['| Criterion | Value | Bar | Result |', '|---|---|---|---|', ...s.criteria.map(c => `| ${c.name} | ${c.value} | ${c.bar} | ${result(c)} |`), '']
      : []),
    ...(s.details.length > 0 ? [...s.details, ''] : []),
    ...calls.map(c => `- ${c}`),
    ...(s.monthly ? [`- At inventory volumes: ${usd(s.monthly.low)}–${usd(s.monthly.high)} per month`] : []),
    '',
  ]
}

export function renderRecalibration(input: RecalibrationReportInput): string {
  const half = input.half === 'all' ? 'the whole phase-1 sample' : `the ${input.half} half of the phase-1 sample`
  return [
    `# GPT-6 recalibration check: ${input.half}`,
    '',
    `Generated ${input.generatedAt} on ${half} (fixtures sampled ${input.fixtures.createdAt}, crawled ${input.fixtures.floor} to ${input.fixtures.anchor.slice(0, 10)}). ` +
      'Prompts are the working tree at run time. Ratings are judged against the stored production values; dedup against phase 1\'s labelled set and gpt-5-nano\'s phase-1 verdicts on it.',
    ...(input.limit != null ? ['', `**Partial run:** at most ${input.limit} batches, stories or sets per check (\`--limit\`). A partial run is not evidence.`] : []),
    '',
    ...input.skipped.map(s => `- Step \`${s.step}\` did not run: ${s.reason}`),
    ...(input.skipped.length > 0 ? [''] : []),
    ...input.sections.flatMap(sectionLines),
    '## Spend',
    '',
    `This run: ${usd(input.thisRunUsd)}. Ledger total for this output folder: ${usd(input.ledgerUsd)} of the ${usd(input.budgetUsd)} budget.`,
    '',
  ].join('\n')
}

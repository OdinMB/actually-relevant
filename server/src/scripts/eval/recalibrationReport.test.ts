import { describe, it, expect } from 'vitest'
import type { Criterion } from './recalibration.js'
import type { StepSection } from './recalibrationChecks.js'
import { recalibrationReportName, renderRecalibration, type RecalibrationReportInput, type ReportNameInput } from './recalibrationReport.js'

const criterion = (name: string, pass: boolean, required = true): Criterion => ({ name, value: 'v', bar: 'b', pass, required })
const section = (criteria: Criterion[]): StepSection => ({
  title: 'Pre-assessment', arm: 'gpt-6-luna@medium', sample: '10 stories', criteria, details: [], stats: [], monthly: { low: 1, high: 2 },
})
const input = (sections: StepSection[], over: Partial<RecalibrationReportInput> = {}): RecalibrationReportInput => ({
  generatedAt: '2026-09-24T00:00:00Z', half: 'calibration', fixtures: { createdAt: 'c', anchor: '2026-02-08T00:00:00Z', floor: '2026-02-01' },
  sections, skipped: [], thisRunUsd: 0, ledgerUsd: 3, budgetUsd: 6, ...over,
})

describe('renderRecalibration', () => {
  it('accepts a section whose only miss is a target that is not required', () => {
    const md = renderRecalibration(input([section([criterion('offset', true), criterion('aim', false, false)])]))
    expect(md).toMatch(/Pre-assessment, gpt-6-luna@medium: accepted/)
    expect(md).toMatch(/\| aim \| v \| b \| missed \(not required\) \|/)
  })

  it('names the required criteria a section fails', () => {
    const md = renderRecalibration(input([section([criterion('offset', false), criterion('share', false), criterion('issue', true)])]))
    expect(md).toMatch(/not accepted \(fails: offset, share\)/)
  })

  const run = (over: Partial<ReportNameInput> = {}): ReportNameInput => ({
    half: 'holdout', effort: 'medium', dedupEffort: 'low', steps: ['preassess', 'assess', 'dedup'], ...over,
  })

  it('names the report by half, and gives a non-default effort its own file', () => {
    expect(recalibrationReportName(run())).toBe('recalibration-holdout.md')
    expect(recalibrationReportName(run({ effort: 'high' }))).toBe('recalibration-holdout-effort-high.md')
    expect(recalibrationReportName(run({ half: 'calibration', dedupEffort: 'medium' }))).toBe('recalibration-calibration-dedup-medium.md')
    expect(recalibrationReportName(run({ half: 'all', effort: 'high', dedupEffort: 'medium' }))).toBe('recalibration-all-effort-high-dedup-medium.md')
  })

  it('gives another step list or a --limit run its own file, so a check never overwrites the report of record', () => {
    expect(recalibrationReportName(run({ half: 'all', steps: ['assess', 'social-post', 'selection'] }))).toBe('recalibration-all-assess-social-post-selection.md')
    expect(recalibrationReportName(run({ limit: 3 }))).toBe('recalibration-holdout-limit-3.md')
    expect(recalibrationReportName(run({ steps: ['dedup', 'assess', 'preassess'] }))).toBe('recalibration-holdout.md')
  })

  it('says a partial run is not evidence and lists skipped steps', () => {
    const md = renderRecalibration(input([], { limit: 1, skipped: [{ step: 'dedup', reason: 'labelled set not in the ledger' }] }))
    expect(md).toMatch(/not evidence/)
    expect(md).toMatch(/dedup.*labelled set not in the ledger/)
  })
})

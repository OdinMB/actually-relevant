import { describe, expect, it } from 'vitest'
import { renderOverviewReport } from './report.js'
import type { UpdateStepReport } from './update.js'
import { updateLines } from './updateReport.js'
import { scoreUpdates } from './updateScore.js'

const report = (over: Partial<UpdateStepReport> = {}): UpdateStepReport => ({
  half: 'judge',
  repeat: 3,
  keys: 9,
  left: [{ what: 'floods-b', reason: 'no researched version: not found, or never researched' }],
  stories: 4,
  cases: { key: 3, 'wrong-number': 4, 'wrong-year': 2, benign: 4 },
  unplaced: 1,
  stated: [],
  refused: [],
  source: { kind: 'legacy' },
  ceiling: false,
  deskUsd: null,
  skipped: [],
  judge: { estimate: { calls: 12, uncached: 12, usd: 0.3 }, stopped: null },
  score: scoreUpdates([]),
  ...over,
})

describe('updateLines', () => {
  it('names the cases, what was left out, the bars and the per-run table', () => {
    const text = updateLines(report()).join('\n')
    expect(text).toContain('**Cases:** 3 key, 4 wrong-number, 2 wrong-year, 4 benign, from 4 researched stories of 9 answer keys (half judge)')
    expect(text).toContain('- Left out: floods-b: no researched version')
    expect(text).toContain('- 1 changed figure values have a quote no section holds')
    expect(text).toContain('**Strong judge on the notes:** 12 calls (12 uncached)')
    expect(text).toContain(
      '| Expected changes flagged on the right section (a turning point: some rewrite rests on it, or on a newer fact of its window) | at least 90.0% | n/a | n/a | no verdicts |',
    )
    expect(text).toContain('| Cases demoting a fact they do not expect | at most 5.0% |')
  })

  it('gives each run its fixed lines served and its notes the fact check found unsupported', () => {
    const c = (hit: number, of: number) => ({ hit, of, share: of === 0 ? null : hit / of })
    const run = {
      run: 1,
      cases: 2,
      outcomes: { updated: 2, unchanged: 0, update_failed: 0, budget: 0, technical: 0 },
      flagged: c(2, 2),
      turning: { of: 3, own: 1, newer: 1 },
      falseRewrites: c(0, 1),
      identical: c(4, 4),
      demoted: c(1, 1),
      falseDemotions: c(0, 2),
      notes: { ...c(1, 2), served: 2, fallback: c(1, 2), written: 3, unsupported: 2 },
      copying: { notes: c(0, 3), paragraphs: c(0, 2) },
    }
    const text = updateLines(report({ score: { ...scoreUpdates([]), runs: [run] } })).join('\n')
    expect(text).toContain('| Notes good | Fixed lines served | Notes unsupported / written |')
    expect(text).toContain('| 1 / 2 (50.0%) | 1 / 2 (50.0%) | 2 / 3 |')
    // How each run met its turning points: on their own facts, or on a newer one of the window
    expect(text).toContain('| Flagged | Turning points: own / newer / of |')
    expect(text).toContain('| 2 / 2 (100.0%) | 1 / 1 / 3 |')
  })

  it('lists the turning points left out as already stated and the plants the sanity check refused', () => {
    const text = updateLines(
      report({
        stated: [{ id: 'floods-a:key', what: 'response: Army opens relief camps' }],
        refused: [
          { slug: 'floods-a', kind: 'wrong-number', change: '22 → 33', reason: 'day' },
          { slug: 'floods-a', kind: 'wrong-year', change: '2026 → 2025', reason: 'period' },
          { slug: 'floods-b', kind: 'wrong-number', change: '100% → 150%', reason: 'share' },
        ],
      }),
    ).join('\n')
    expect(text).toContain('- 1 turning point the story already states: left out of the expectations.')
    expect(text).toContain('- 3 planted values refused by the sanity check (day 1, share 1, period 1)')
    expect(text).toContain('- floods-a:key: response: Army opens relief camps')
    expect(text).toContain('- floods-a wrong-number: 22 → 33: a day of the month')
  })

  it('says when the judge did not run, and gives the report its section', () => {
    const stopped = report({ judge: { estimate: { calls: 2, uncached: 2, usd: 0.05 }, stopped: '2 uncached calls and OPENAI_API_KEY is missing' } })
    expect(updateLines(stopped).join('\n')).toContain('**The strong judge did not run:** 2 uncached calls and OPENAI_API_KEY is missing')
    const page = renderOverviewReport({ generatedAt: 'now', steps: ['update'], update: stopped, skipped: [], thisRunUsd: 0, folderUsd: 0, budgetUsd: 3 })
    expect(page).toContain("## A later pass's updates against the bars")
  })
})

import { describe, it, expect } from 'vitest'
import { countLine, overviewHead, OVERVIEW_LABEL_TEXT, roleLine, statusLine } from './overviewCopy'

const head = { status: 'open' as const, since: '2026-03-04T08:00:00.000Z', closedAt: null, closedReason: null, lastEntryAt: '2026-11-18T08:00:00.000Z' }

describe('statusLine', () => {
  it('says since when an open ongoing story was founded', () => {
    expect(statusLine(head)).toBe('Ongoing story · since March 2026')
  })

  it('says when a quiet one last had a story, and when one an editor closed ended', () => {
    expect(statusLine({ ...head, status: 'quiet' })).toBe('No new reporting since Nov 18, 2026')
    expect(statusLine({ ...head, status: 'closed', closedReason: 'editor', closedAt: '2026-11-19T10:00:00.000Z' })).toBe('Ended Nov 19, 2026')
  })

  it('reads a faded one as a quiet one, by its last story, not the day it faded', () => {
    expect(statusLine({ ...head, status: 'closed', closedReason: 'faded', closedAt: '2027-03-18T03:00:00.000Z' })).toBe('No new reporting since Nov 18, 2026')
  })
})

describe('countLine', () => {
  it('counts the stories and names the last change', () => {
    expect(countLine({ stories: 12, lastChange: '2026-11-18T08:00:00.000Z' })).toBe('12 stories · last change Nov 18, 2026')
    expect(countLine({ stories: 1, lastChange: '2026-11-18T08:00:00.000Z' })).toBe('1 story · last change Nov 18, 2026')
  })
})

describe('roleLine', () => {
  it("names a turning point's kind, and nothing for a routine story", () => {
    expect(roleLine({ role: 'turning_point', roleKind: 'deescalation' })).toBe('Turning point · de-escalation')
    expect(roleLine({ role: 'turning_point', roleKind: 'a-kind-added-later' })).toBe('Turning point')
    expect(roleLine({ role: 'routine', roleKind: null })).toBeNull()
  })
})

describe('overviewHead', () => {
  it("writes the server's link-preview title and description, the owner's AI label last", () => {
    // The label's owner-approved wording, as server/src/lib/aiLabelCopy.ts holds it (OVERVIEW_AI_LABEL)
    expect(OVERVIEW_LABEL_TEXT).toBe('Summary and timeline by AI, from our stories and their sources.')
    expect(overviewHead({ title: 'Ebola in Ituri', stories: 3, since: '2026-10-01T08:00:00.000Z' })).toEqual({
      title: 'Ebola in Ituri: ongoing story - Actually Relevant',
      description: '3 stories since October 2026, followed as one ongoing story. Summary and timeline by AI, from our stories and their sources.',
    })
  })
})

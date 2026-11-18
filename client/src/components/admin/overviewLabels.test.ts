import { describe, it, expect } from 'vitest'
import { actorLabel, decisionKindLabel, detachLabel, parseRoleValue, roleLabel, roleValue } from './overviewLabels'
import { describeStatus } from './OverviewDecisionLog'

describe('overview labels', () => {
  it('reads a role select value back, refusing a turning point without a known kind', () => {
    expect(parseRoleValue(roleValue('turning_point', 'spread'))).toEqual({ role: 'turning_point', roleKind: 'spread' })
    expect(parseRoleValue(roleValue('routine', null))).toEqual({ role: 'routine', roleKind: null })
    expect(parseRoleValue('turning_point:')).toBeNull()
    expect(parseRoleValue('turning_point:weather')).toBeNull()
    expect(roleLabel('turning_point', null)).toBe('Turning point')
    expect(roleLabel('turning_point', 'deescalation')).toBe('Turning point: De-escalation')
  })

  it('names who acted and why an entry left, falling back for what it does not know', () => {
    expect([actorLabel('pipeline'), actorLabel('review'), actorLabel('editor'), actorLabel('u1', 'Odin'), actorLabel('u1')]).toEqual([
      'Pipeline',
      'Review',
      'An editor',
      'Odin',
      'An editor',
    ])
    expect(detachLabel('unpublished')).toBe('Detached when its story was unpublished')
    expect(detachLabel(null)).toBe('Detached')
    expect(decisionKindLabel('found')).toBe('Founding')
    expect(decisionKindLabel('something_new')).toBe('something_new')
  })

  it('describes a status move by its from and to, or else by its outcome', () => {
    expect(describeStatus({ outcome: 'closed', inputs: { from: 'quiet', to: 'closed', reason: 'faded' } })).toBe('quiet to closed (faded)')
    expect(describeStatus({ outcome: 'frozen', inputs: { anomaly: 'burst', joins: 6 } })).toBe('frozen')
    expect(describeStatus({ outcome: 'not_happened', inputs: null })).toBe('not happened')
  })
})

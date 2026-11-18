import type { OverviewEntryRole, OverviewRoleKind, OverviewScope, OverviewStatus } from '@shared/types'

/*
 * The words the admin's overview pages and the story's Overview block use for an overview's
 * fields, an entry's role and a decision's kind (`.context/overviews.md`, "Admin").
 */

export const SCOPE_LABELS: Record<OverviewScope, string> = { single: 'Single', forming: 'Forming', ongoing: 'Ongoing' }
export const STATUS_LABELS: Record<OverviewStatus, string> = { open: 'Open', quiet: 'Quiet', closing: 'Closing', closed: 'Closed' }

export const ROLE_KIND_LABELS: Record<OverviewRoleKind, string> = {
  setback: 'Setback',
  response: 'Response',
  spread: 'Spread',
  decision: 'Decision',
  escalation: 'Escalation',
  deescalation: 'De-escalation',
  money: 'Money',
  science: 'Science',
  people: 'People',
  milestone: 'Milestone',
}
export const ROLE_KINDS = Object.keys(ROLE_KIND_LABELS) as OverviewRoleKind[]

export function roleLabel(role: OverviewEntryRole, kind: OverviewRoleKind | null): string {
  if (role === 'routine') return 'Routine'
  return kind ? `Turning point: ${ROLE_KIND_LABELS[kind]}` : 'Turning point'
}

/** A role as one select value: `routine` or `turning_point:<kind>`. */
export const roleValue = (role: OverviewEntryRole, kind: OverviewRoleKind | null): string => (role === 'routine' ? 'routine' : `turning_point:${kind ?? ''}`)

export function parseRoleValue(value: string): { role: OverviewEntryRole; roleKind: OverviewRoleKind | null } | null {
  if (value === 'routine') return { role: 'routine', roleKind: null }
  const kind = value.startsWith('turning_point:') ? value.slice('turning_point:'.length) : ''
  return (ROLE_KINDS as string[]).includes(kind) ? { role: 'turning_point', roleKind: kind as OverviewRoleKind } : null
}

export const ROLE_OPTIONS = [
  { value: 'routine', label: 'Routine' },
  ...ROLE_KINDS.map(k => ({ value: `turning_point:${k}`, label: `Turning point: ${ROLE_KIND_LABELS[k]}` })),
]

const DETACH_REASONS: Record<string, string> = {
  unpublished: 'Detached when its story was unpublished',
  review: 'Detached by a review',
  editor: 'Detached by an editor',
  undone: 'Detached by an undo',
}

export const detachLabel = (reason: string | null): string => (reason && DETACH_REASONS[reason]) || 'Detached'

const DECISION_KINDS: Record<string, string> = {
  link: 'Link',
  found: 'Founding',
  role: 'Role',
  stands: 'Where this stands',
  status: 'Status',
  close: 'End event',
  review: 'Review',
  editor_attach: 'Editor attached a story',
  editor_detach: 'Editor detached a story',
  editor_role: 'Editor set a role',
  editor_retitle: 'Editor retitled',
  editor_freeze: 'Editor froze or unfroze',
  editor_hide: 'Editor hid or showed',
  editor_close: 'Editor closed or reopened',
  undo: 'Undo',
}

export const decisionKindLabel = (kind: string): string => DECISION_KINDS[kind] ?? kind

/** The decisions that make an overview's status history: its status moves, end-event checks, and an editor's close, reopen and freeze. */
export const STATUS_KINDS = ['status', 'close', 'editor_close', 'editor_freeze']

/** Who made a decision or an entry: the pipeline, a review, or an editor (by name where the log has it). */
export function actorLabel(actor: string, name: string | null = null): string {
  if (actor === 'pipeline') return 'Pipeline'
  if (actor === 'review') return 'Review'
  if (actor === 'editor') return 'An editor'
  return name ?? 'An editor'
}

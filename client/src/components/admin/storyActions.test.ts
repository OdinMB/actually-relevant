import { describe, it, expect } from 'vitest'
import type { StoryStatus } from '@shared/types'
import { STORY_STATUSES } from '@shared/constants'
import { actionConfirmation, busyReason, publishRefusal, statusActions } from './storyActions'

const offered = (status: StoryStatus) => {
  const { primary, others } = statusActions(status)
  return [...(primary ? [primary] : []), ...others]
}
const offering = (action: string) => STORY_STATUSES.filter(s => offered(s).includes(action as never))

describe('statusActions', () => {
  it('puts the next step of the pipeline first: pre-assess, assess, then publish', () => {
    expect(statusActions('fetched').primary).toBe('preassess')
    expect(statusActions('pre_analyzed').primary).toBe('assess')
    expect(statusActions('analyzed').primary).toBe('publish')
    expect(statusActions('selected').primary).toBe('publish')
    for (const status of ['published', 'rejected', 'trashed'] as const) expect(statusActions(status).primary).toBeNull()
  })

  it('offers Publish on every status but published', () => {
    expect(offering('publish')).toEqual(STORY_STATUSES.filter(s => s !== 'published'))
  })

  it('offers Re-assess once a story was assessed or rejected, never on a trashed story (the server refuses it)', () => {
    expect(offering('reassess').sort()).toEqual(['analyzed', 'published', 'rejected', 'selected'])
  })

  it('offers Research only where a run may start, and Gather context only on a published story', () => {
    expect(offering('research').sort()).toEqual(['analyzed', 'published', 'selected'])
    expect(offering('gather')).toEqual(['published'])
  })

  it('offers Reject and Trash on every status but their own', () => {
    expect(offering('reject')).toEqual(STORY_STATUSES.filter(s => s !== 'rejected'))
    expect(offering('trash')).toEqual(STORY_STATUSES.filter(s => s !== 'trashed'))
  })

  it('offers each action at most once', () => {
    for (const status of STORY_STATUSES) expect(new Set(offered(status)).size).toBe(offered(status).length)
  })

  it('offers "Research again" in place of Research and Gather context while research passes are on, and never while they are off', () => {
    const withPasses = (status: StoryStatus) => {
      const { primary, others } = statusActions(status, { passes: true })
      return [...(primary ? [primary] : []), ...others]
    }
    expect(STORY_STATUSES.filter(s => withPasses(s).includes('research-again')).sort()).toEqual(['analyzed', 'published', 'selected'])
    for (const status of STORY_STATUSES) {
      expect(withPasses(status)).not.toContain('research')
      expect(withPasses(status)).not.toContain('gather')
      expect(offered(status)).not.toContain('research-again')
      // Everything else stays where it was
      expect(withPasses(status).filter(a => a !== 'research-again')).toEqual(offered(status).filter(a => a !== 'research' && a !== 'gather'))
    }
  })
})

describe('actionConfirmation', () => {
  const clean = { dirty: false, researched: false }
  const dirty = { dirty: true, researched: false }

  it('runs an action at once while nothing is unsaved', () => {
    for (const action of ['preassess', 'assess', 'publish', 'reject', 'trash', 'research', 'gather'] as const)
      expect(actionConfirmation(action, clean)).toBeNull()
  })

  it('asks before an action that changes the story throws unsaved edits away', () => {
    const asked = actionConfirmation('publish', dirty)
    expect(asked).toMatchObject({ discards: true, variant: 'danger' })
    expect(asked?.confirmLabel).toMatch(/publish/i)
  })

  it('never asks before research or gathering context, which leave the story as it is', () => {
    expect(actionConfirmation('research', dirty)).toBeNull()
    expect(actionConfirmation('gather', dirty)).toBeNull()
  })

  it('asks before "Research again" only while edits are unsaved: the pass applies its own result', () => {
    expect(actionConfirmation('research-again', clean)).toBeNull()
    expect(actionConfirmation('research-again', dirty)).toMatchObject({ discards: true, confirmLabel: 'Discard and research again' })
  })

  it('always asks before a re-assessment, naming the researched version it drops, and discards only unsaved edits', () => {
    expect(actionConfirmation('reassess', clean)).toMatchObject({ discards: false })
    expect(actionConfirmation('reassess', clean)?.description).not.toMatch(/researched version/)
    expect(actionConfirmation('reassess', { dirty: false, researched: true })?.description).toMatch(/researched version/)
    expect(actionConfirmation('reassess', dirty)).toMatchObject({ discards: true })
    expect(actionConfirmation('reassess', dirty)?.description).toMatch(/unsaved/)
  })
})

describe('busyReason', () => {
  it('says what keeps the actions closed: a save, a status change, then a task on the story', () => {
    expect(busyReason({ saving: false, changingStatus: false, processing: false })).toBeNull()
    expect(busyReason({ saving: true, changingStatus: true, processing: true })).toMatch(/Saving/)
    expect(busyReason({ saving: false, changingStatus: true, processing: true })).toMatch(/status/)
    expect(busyReason({ saving: false, changingStatus: false, processing: true })).toMatch(/task/)
  })
})

describe('publishRefusal', () => {
  it('closes Publish until the story has a rating', () => {
    expect(publishRefusal({ relevance: null })).toMatch(/rating/)
    expect(publishRefusal({ relevance: 6 })).toBeNull()
  })
})

import { useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { adminApi } from '../../../lib/admin-api'
import { invalidateStoryQueries } from '../../../hooks/useStories'
import { useToast } from '../../ui/Toast'
import { BlueskyDraftPanel } from '../BlueskyDraftPanel'
import { MastodonDraftPanel } from '../MastodonDraftPanel'
import type { SocialDraft, SocialDraftPanelProps } from './SocialDraftPanel'

export type SocialChannel = 'bluesky' | 'mastodon'

/** A channel's draft panel, as the stories list's bulk drafts drive it. */
export interface DraftPanel {
  /** Opened empty, while the draft is made. */
  open: () => void
  show: (draft: unknown) => void
  close: () => void
}

interface PanelState {
  open: boolean
  draft: SocialDraft | null
  publishing: boolean
}

const CLOSED: PanelState = { open: false, draft: null, publishing: false }
const CHANNELS = { bluesky: { name: 'Bluesky', Panel: BlueskyDraftPanel }, mastodon: { name: 'Mastodon', Panel: MastodonDraftPanel } } as const
const message = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback)

/**
 * The Bluesky and Mastodon draft panels of a page that drafts social posts (the stories list, for
 * its bulk drafts; a story's page, for its own post): their state, what they publish, save and
 * delete through, and their elements, which the page renders outside any form of its own.
 * `onPublished` runs after a post goes out (the list clears its selection).
 */
export function useSocialDrafts({ onPublished }: { onPublished?: () => void } = {}): {
  drafts: Record<SocialChannel, DraftPanel>
  generate: (channel: SocialChannel, storyId: string) => void
  panels: ReactNode
} {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [panels, setPanels] = useState<Record<SocialChannel, PanelState>>({ bluesky: CLOSED, mastodon: CLOSED })
  const patch = (channel: SocialChannel, change: Partial<PanelState>) => setPanels(all => ({ ...all, [channel]: { ...all[channel], ...change } }))

  const panel = (channel: SocialChannel): DraftPanel => ({
    open: () => patch(channel, { open: true, draft: null }),
    show: draft => patch(channel, { draft: draft as SocialDraft }),
    close: () => patch(channel, { open: false }),
  })
  const drafts = { bluesky: panel('bluesky'), mastodon: panel('mastodon') }

  const generate = (channel: SocialChannel, storyId: string) => {
    drafts[channel].open()
    adminApi[channel]
      .generateDraft(storyId)
      .then(drafts[channel].show)
      .catch((err: unknown) => {
        toast('error', message(err, 'Failed to generate draft'))
        drafts[channel].close()
      })
  }

  const handlers = (channel: SocialChannel): Omit<SocialDraftPanelProps, 'open' | 'draft' | 'publishing'> => ({
    onClose: () => patch(channel, { open: false, draft: null }),
    onPublish: async postId => {
      patch(channel, { publishing: true })
      try {
        await adminApi[channel].publishPost(postId)
        toast('success', `Posted to ${CHANNELS[channel].name}`)
        patch(channel, { open: false, draft: null })
        onPublished?.()
        invalidateStoryQueries(queryClient)
      } catch (err) {
        toast('error', message(err, 'Failed to publish'))
      } finally {
        patch(channel, { publishing: false })
      }
    },
    onUpdate: async (postId, text) => {
      try {
        await adminApi[channel].updateDraft(postId, text)
      } catch (err) {
        toast('error', message(err, 'Failed to save draft'))
        throw err
      }
    },
    onDelete: async postId => {
      try {
        await adminApi[channel].deletePost(postId)
      } catch (err) {
        toast('error', message(err, 'Failed to delete draft'))
        throw err
      }
    },
  })

  return {
    drafts,
    generate,
    panels: (Object.keys(CHANNELS) as SocialChannel[]).map(channel => {
      const { Panel } = CHANNELS[channel]
      const { open, draft, publishing } = panels[channel]
      return <Panel key={channel} open={open} draft={draft} publishing={publishing} {...handlers(channel)} />
    }),
  }
}

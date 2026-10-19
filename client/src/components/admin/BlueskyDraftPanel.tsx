import {
  SocialDraftPanel,
  type SocialDraft,
  type SocialDraftChannel,
  type SocialDraftPanelProps,
} from './social/SocialDraftPanel'

export type BlueskyDraft = SocialDraft

const LIMIT = 300

/** Count graphemes (user-perceived characters) using Intl.Segmenter. */
function countGraphemes(text: string): number {
  // Intl.Segmenter is widely supported but not in all TS lib targets
  const IntlAny = Intl as any
  if (typeof IntlAny.Segmenter === 'function') {
    const segmenter = new IntlAny.Segmenter('en', { granularity: 'grapheme' })
    return [...segmenter.segment(text)].length
  }
  // Fallback: spread into array (handles most emoji correctly)
  return [...text].length
}

const blueskyDraftChannel: SocialDraftChannel = {
  name: 'Bluesky',
  textareaId: 'bluesky-post-text',
  textareaRows: 5,
  limit: LIMIT,
  count: countGraphemes,
  nearLimit: LIMIT - 20,
  hint: 'Links are added automatically',
  renderDetails: (draft) => (
    /* Link preview */
    <div>
      <p className="text-sm font-medium text-neutral-700 mb-2">Links</p>
      <div className="space-y-2 text-sm">
        <div className="flex items-start gap-2">
          <span className="shrink-0 text-neutral-400">Card:</span>
          <span className="text-brand-700 break-all">
            actuallyrelevant.com/stories/{draft.story.slug || '...'}
          </span>
        </div>
        <div className="flex items-start gap-2">
          <span className="shrink-0 text-neutral-400">Source:</span>
          <span className="text-neutral-600 break-all">{draft.story.sourceUrl}</span>
        </div>
      </div>
    </div>
  ),
}

export function BlueskyDraftPanel(props: SocialDraftPanelProps) {
  return <SocialDraftPanel channel={blueskyDraftChannel} {...props} />
}

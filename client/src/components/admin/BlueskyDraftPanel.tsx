import {
  SocialDraftPanel,
  type SocialDraft,
  type SocialDraftChannel,
  type SocialDraftPanelProps,
} from './social/SocialDraftPanel'

import { SITE_URL } from '../../config'

export type BlueskyDraft = SocialDraft

const LIMIT = 300
// The card links our story page on the live site (server: `${config.siteUrl}/stories/<slug>`)
const SITE_HOST = new URL(SITE_URL).host

/** Count graphemes (user-perceived characters) using Intl.Segmenter. */
function countGraphemes(text: string): number {
  // Intl.Segmenter is widely supported but not in the ES2020 lib this client targets
  type GraphemeSegmenter = new (locale: string, options: { granularity: 'grapheme' }) => { segment(text: string): Iterable<unknown> }
  const Segmenter = (Intl as unknown as { Segmenter?: GraphemeSegmenter }).Segmenter
  if (typeof Segmenter === 'function') {
    const segmenter = new Segmenter('en', { granularity: 'grapheme' })
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
            {SITE_HOST}/stories/{draft.story.slug || '...'}
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

import {
  SocialDraftPanel,
  type SocialDraft,
  type SocialDraftChannel,
  type SocialDraftPanelProps,
} from './social/SocialDraftPanel'

export type MastodonDraft = SocialDraft

const CHAR_LIMIT = 500

const mastodonDraftChannel: SocialDraftChannel = {
  name: 'Mastodon',
  textareaId: 'mastodon-post-text',
  textareaRows: 7,
  limit: CHAR_LIMIT,
  count: (text) => text.length,
  nearLimit: CHAR_LIMIT - 20,
  hint: 'Link preview auto-generated from URL',
  renderDetails: () => (
    /* Posting info */
    <div className="rounded-md bg-neutral-50 border border-neutral-200 p-3">
      <p className="text-xs text-neutral-500">
        Visibility: <span className="font-medium text-neutral-700">unlisted</span> · Mastodon will auto-generate a link preview from the URL in the post text.
      </p>
    </div>
  ),
}

export function MastodonDraftPanel(props: SocialDraftPanelProps) {
  return <SocialDraftPanel channel={mastodonDraftChannel} {...props} />
}

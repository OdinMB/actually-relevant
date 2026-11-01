import type { FeedContentSource } from '@shared/types'
import { FEED_CONTENT_SOURCES } from '@shared/constants'
import { Select } from '../ui/Select'

interface FeedContentSourceFieldProps {
  value: FeedContentSource
  onChange: (value: FeedContentSource) => void
}

function isContentSource(value: string): value is FeedContentSource {
  return FEED_CONTENT_SOURCES.some(source => source.value === value)
}

/** Where the crawler takes a feed's article text, shared by the create dialog and the edit panel. */
export function FeedContentSourceField({ value, onChange }: FeedContentSourceFieldProps) {
  return (
    <div>
      <Select
        id="feed-content-source"
        label="Article text"
        value={value}
        onChange={e => {
          if (isContentSource(e.target.value)) onChange(e.target.value)
        }}
        options={FEED_CONTENT_SOURCES}
        aria-describedby="feed-content-source-hint"
      />
      <p id="feed-content-source-hint" className="mt-1 text-xs text-neutral-500">
        Use the full text in the RSS item for publishers whose terms forbid fetching their pages, such as Substack newsletters. Article pages are then never
        fetched, and items whose feed text is too short are skipped.
      </p>
    </div>
  )
}

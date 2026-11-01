import { useState } from 'react'
import { API_BASE } from '../lib/api'

/**
 * Where a feed's favicon is looked for, in order: the API, which stores every fetched favicon
 * (server/src/routes/public/feedFavicon.ts), then the file committed under public/images/feeds/
 * before favicons moved to the database. A `cacheKey` gives the API URL a new address after an
 * admin refetch, past the browser's cached copy.
 */
function faviconSources(feedId: string, cacheKey: number): string[] {
  return [`${API_BASE}/feeds/${feedId}/favicon${cacheKey ? `?t=${cacheKey}` : ''}`, `/images/feeds/${feedId}.png`]
}

/** The first source that has not failed to load (null once all have), and the handler that moves past it. */
function useFallbackSrc(sources: string[]): { src: string | null; onError: () => void } {
  const first = sources[0]
  const [failed, setFailed] = useState({ first, count: 0 })
  // Another feed, or a refetch, starts from the first source again
  const count = failed.first === first ? failed.count : 0
  return { src: sources[count] ?? null, onError: () => setFailed({ first, count: count + 1 }) }
}

interface FeedFaviconProps {
  feedId: string
  size?: number
  className?: string
}

/**
 * Public feed favicon — hides itself if no source has the image.
 * Used in story cards and story pages.
 */
export default function FeedFavicon({ feedId, size = 16, className = '' }: FeedFaviconProps) {
  const { src, onError } = useFallbackSrc(faviconSources(feedId, 0))

  if (!src) return null

  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      className={`inline-block rounded-sm ${className}`}
      style={{ width: size, height: size }}
      onError={onError}
    />
  )
}

/**
 * Admin feed favicon — shows a neutral placeholder if no source has the image.
 * Used in feed table and edit panel. A new `imgKey` loads it again after a refetch.
 */
export function FeedFaviconPreview({ feedId, imgKey = 0, size = 20 }: { feedId: string; imgKey?: number; size?: number }) {
  const { src, onError } = useFallbackSrc(faviconSources(feedId, imgKey))

  if (!src) {
    return <span className="inline-block rounded-sm bg-neutral-100 border border-neutral-200" style={{ width: size, height: size }} aria-hidden="true" />
  }

  return <img src={src} alt="" width={size} height={size} className="inline-block rounded-sm bg-neutral-100" onError={onError} />
}

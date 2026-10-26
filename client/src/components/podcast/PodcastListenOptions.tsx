import { useEffect, useRef, useState } from 'react'
import type { PublicPodcastResponse } from '@shared/types'
import { APPLE_PODCASTS_URL } from '../../config'

type ListenLink = PublicPodcastResponse['show']['listenLinks'][number]

/**
 * Shown until the show data arrives, and if it cannot be loaded: the static page (prerendered,
 * no data yet) still has its Apple Podcasts badge.
 */
const FALLBACK_LINKS: ListenLink[] = [{ name: 'Apple Podcasts', url: APPLE_PODCASTS_URL }]

/** As tall as the Apple badge, so the row reads as one set of options. */
const BUTTON_CLASS =
  'inline-flex h-[50px] items-center rounded-lg border border-brand-700 px-5 font-medium text-brand-700 transition-colors hover:bg-brand-50 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2'

const COPIED_VISIBLE_MS = 4000

/** How long the status stays empty before a result shows: long enough for screen readers to register the change. */
const REANNOUNCE_DELAY_MS = 100

const COPY_STATUS_TEXT = {
  idle: '',
  copied: 'Copied',
  failed: 'Could not copy. Please select the address below.',
} as const

function isApplePodcasts(url: string): boolean {
  try {
    return new URL(url).hostname === 'podcasts.apple.com'
  } catch {
    return false
  }
}

function ListenLinkItem({ link }: { link: ListenLink }) {
  if (isApplePodcasts(link.url)) {
    return (
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block rounded-lg focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
      >
        {/* Apple's official badge, used unmodified (Apple Podcasts identity guidelines). */}
        <img
          src="/images/social/apple-podcasts-badge.svg"
          alt="Listen on Apple Podcasts (opens in new tab)"
          width={158}
          height={50}
          className="block h-[50px] w-auto"
        />
      </a>
    )
  }
  return (
    <a href={link.url} target="_blank" rel="noopener noreferrer" className={BUTTON_CLASS}>
      <span className="sr-only">Listen on </span>
      {link.name}
      <span className="sr-only"> (opens in new tab)</span>
    </a>
  )
}

/**
 * Copies the feed address. The status region is always in the page, so screen readers announce
 * "Copied" (or the fallback) when its text changes. Each press empties it first and shows the
 * result a moment later, so a second "Copied" in a row is a change and is announced too.
 */
function CopyFeedButton({ feedUrl }: { feedUrl: string }) {
  const [status, setStatus] = useState<keyof typeof COPY_STATUS_TEXT>('idle')
  const timer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => () => clearTimeout(timer.current), [])

  function show(result: 'copied' | 'failed') {
    clearTimeout(timer.current)
    setStatus('idle')
    timer.current = setTimeout(() => {
      setStatus(result)
      if (result === 'copied') timer.current = setTimeout(() => setStatus('idle'), COPIED_VISIBLE_MS)
    }, REANNOUNCE_DELAY_MS)
  }

  async function copy() {
    clearTimeout(timer.current)
    try {
      // Throws where the browser has no Clipboard API (an insecure context, an old browser)
      await navigator.clipboard.writeText(feedUrl)
      show('copied')
    } catch {
      show('failed')
    }
  }

  return (
    <>
      <button type="button" className={BUTTON_CLASS} onClick={() => void copy()}>
        Copy RSS feed
      </button>
      <span role="status" className="text-sm text-neutral-600">
        {COPY_STATUS_TEXT[status]}
      </span>
    </>
  )
}

/**
 * The /podcast Subscribe area: one row with every listing in `config.podcast.listenLinks`, in its
 * order (Apple Podcasts as Apple's badge, the others as buttons), then "Copy RSS feed"; below it,
 * the feed address as plain text to select. The address is not a link: on a phone it would open
 * the XML in the browser. `listenLinks` is undefined until the show data loads, and if it fails.
 */
export default function PodcastListenOptions({ listenLinks, feedUrl }: { listenLinks: ListenLink[] | undefined; feedUrl: string }) {
  const links = listenLinks ?? FALLBACK_LINKS
  return (
    <>
      <ul className="flex flex-wrap items-center gap-3">
        {links.map(link => (
          <li key={link.url}>
            <ListenLinkItem link={link} />
          </li>
        ))}
        {/* Its own line on phones, so a listing arriving with the data never pushes it to a new line */}
        <li className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 sm:w-auto">
          <CopyFeedButton feedUrl={feedUrl} />
        </li>
      </ul>
      <p className="mt-4 text-lg leading-relaxed text-neutral-600">
        Or add the feed to any podcast app that accepts an RSS address: <span className="select-all break-all text-neutral-800">{feedUrl}</span>
      </p>
    </>
  )
}

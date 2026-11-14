import { useState } from 'react'
import type { ResearchedSource } from '@shared/types'
import { API_BASE } from '../../lib/api'
import { initialOf } from './sourceText'

/** Our own icon, for our earlier stories: the site's favicon, drawn in a brand-colored ring. */
const OUR_ICON = '/favicon-32x32.png'

const BOX = 'inline-block h-4 w-4 shrink-0 align-middle'

/**
 * A research source's 16 px icon: the outlet's favicon as we store it (`/api/source-favicons/:host`,
 * never loaded from the outlet, which would tell it about our visitors); the outlet's initial in a
 * neutral circle when none is stored or it fails to load; our icon in the brand ring for our earlier
 * stories. `framed` draws a thin neutral frame around an outlet's favicon, for icons side by side
 * (the header's sources link), where a white favicon would otherwise run into the next; the initial
 * and our ringed icon look the same either way. Decorative: what holds the icon names the outlet.
 */
export function SourceIcon({ source, framed = false, className = '' }: { source: ResearchedSource; framed?: boolean; className?: string }) {
  const [failedHost, setFailedHost] = useState<string | null>(null)

  if (source.origin === 'earlier') {
    return <img src={OUR_ICON} alt="" width={16} height={16} className={`${BOX} rounded-sm bg-white ring-1 ring-brand-500 ${className}`} />
  }
  const host = source.host
  if (host && failedHost !== host) {
    return (
      <img
        src={`${API_BASE}/source-favicons/${encodeURIComponent(host)}`}
        alt=""
        width={16}
        height={16}
        loading="lazy"
        decoding="async"
        className={`${BOX} rounded-sm bg-white ${framed ? 'ring-1 ring-neutral-300' : ''} ${className}`}
        onError={() => setFailedHost(host)}
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      className={`${BOX} inline-flex items-center justify-center rounded-full bg-neutral-200 text-[10px] font-semibold leading-none text-neutral-700 ${className}`}
    >
      {initialOf(source.outlet)}
    </span>
  )
}

import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * Brings the element the URL's `#hash` names into view, so a link to a section of the page
 * (`PODCAST_SUBSCRIBE_PATH`) lands on it. `PublicLayout` scrolls to the top on every page change in
 * a layout effect; this passive effect runs after it.
 */
export function useScrollToHash() {
  const { hash } = useLocation()
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView()
  }, [hash])
}

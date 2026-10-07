import { useSyncExternalStore } from 'react'
import { getSavedSlugs, subscribeSaved } from '../lib/preferences'

function getSavedCount(): number {
  return getSavedSlugs().length
}

/**
 * Server snapshot, for hydration only. The prerender runs in a fresh browser with nothing
 * saved, so prerendered pages carry no Saved link either; the client adds it on its first render.
 */
function getPrerenderCount(): number {
  return 0
}

/**
 * Number of stories saved in this browser, kept current as stories are saved or removed here
 * or in another tab.
 */
export function useSavedCount(): number {
  return useSyncExternalStore(subscribeSaved, getSavedCount, getPrerenderCount)
}

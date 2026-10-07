const PREFERRED_ISSUES_KEY = 'ar-preferred-issues'
const SAVED_STORIES_KEY = 'ar-saved-stories'
const MAX_SAVED = 100

// --- Issue preferences ---

export function getPreferredIssues(): string[] {
  try {
    const raw = localStorage.getItem(PREFERRED_ISSUES_KEY)
    if (!raw) return []
    return JSON.parse(raw) as string[]
  } catch {
    return []
  }
}

export function setPreferredIssues(slugs: string[]): void {
  try {
    localStorage.setItem(PREFERRED_ISSUES_KEY, JSON.stringify(slugs))
  } catch {
    // silently ignore
  }
}

export function hasSetPreferences(): boolean {
  return localStorage.getItem(PREFERRED_ISSUES_KEY) !== null
}

// --- Saved stories ---

/** Fired on window whenever this tab changes the saved stories; other tabs get a `storage` event. */
export const SAVED_CHANGED_EVENT = 'ar-saved-changed'

/** Calls `onChange` when the saved stories change in this tab or another; returns the unsubscribe. */
export function subscribeSaved(onChange: () => void): () => void {
  window.addEventListener('storage', onChange)
  window.addEventListener(SAVED_CHANGED_EVENT, onChange)
  return () => {
    window.removeEventListener('storage', onChange)
    window.removeEventListener(SAVED_CHANGED_EVENT, onChange)
  }
}

function getSavedArray(): string[] {
  try {
    const raw = localStorage.getItem(SAVED_STORIES_KEY)
    if (!raw) return []
    return JSON.parse(raw) as string[]
  } catch {
    return []
  }
}

function saveSavedArray(slugs: string[]): void {
  try {
    localStorage.setItem(SAVED_STORIES_KEY, JSON.stringify(slugs.slice(-MAX_SAVED)))
  } catch {
    // silently ignore
  }
  window.dispatchEvent(new Event(SAVED_CHANGED_EVENT))
}

export function getSavedSlugs(): string[] {
  return getSavedArray()
}

export function isSaved(slug: string): boolean {
  return getSavedArray().includes(slug)
}

export function toggleSaved(slug: string): boolean {
  const arr = getSavedArray()
  const idx = arr.indexOf(slug)
  if (idx >= 0) {
    arr.splice(idx, 1)
    saveSavedArray(arr)
    return false // now unsaved
  } else {
    arr.push(slug)
    saveSavedArray(arr)
    return true // now saved
  }
}

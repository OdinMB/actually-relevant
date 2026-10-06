/**
 * Noticing that a newer build of the site is deployed than the one running in this tab. Each build
 * compiles its id in (`__BUILD_ID__`) and writes the same id to `/version.json`; an admin tab left open
 * across a deploy keeps running the old code (old labels, missing buttons) until it is reloaded.
 */

export const RUNNING_BUILD_ID: string = __BUILD_ID__

/** The deployed build's id, or null when it cannot be read (no version file, as on the dev server, or offline). */
export async function fetchDeployedBuildId(): Promise<string | null> {
  try {
    const res = await fetch('/version.json', { cache: 'no-store' })
    if (!res.ok) return null
    const body: unknown = await res.json()
    if (typeof body !== 'object' || body === null || !('buildId' in body)) return null
    return typeof body.buildId === 'string' ? body.buildId : null
  } catch {
    return null
  }
}

/** True when a build other than the running one is deployed; unknown counts as current. */
export function isOutdated(deployed: string | null, running: string = RUNNING_BUILD_ID): boolean {
  return deployed != null && deployed !== running
}

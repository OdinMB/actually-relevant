import { PRERENDER_FLAG } from '../lib/prerenderFlag'

/** Sets or clears the flag the build's prerenderer sets on the window, which `isPrerendering()` (lib/renderComplete.ts) reads. */
export function setPrerendering(on: boolean): void {
  if (on) window[PRERENDER_FLAG] = true
  else Reflect.deleteProperty(window, PRERENDER_FLAG)
}

/** Runs `body` as in the build's prerenderer. */
export async function inPrerenderer(body: () => Promise<void>): Promise<void> {
  setPrerendering(true)
  try {
    await body()
  } finally {
    setPrerendering(false)
  }
}

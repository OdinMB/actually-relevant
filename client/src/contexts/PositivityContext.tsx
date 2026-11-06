import { createContext, useContext, useState, useEffect } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { isPrerendering } from '../lib/renderComplete'

interface PositivityContextValue {
  /** 0 = all negative, 25, 50 = balanced, 75, 100 = all positive */
  positivity: number
  setPositivity: (value: number) => void
}

const PositivityContext = createContext<PositivityContextValue>({
  positivity: 50,
  setPositivity: () => {},
})

const STORAGE_KEY = 'ar-positivity'
const VALID_VALUES = [0, 25, 50, 75, 100]

/** Query parameter that sets the mix, e.g. `/?mix=uplifting`. Also accepts the numbers 0–100. */
export const MIX_PARAM = 'mix'
const MIX_NAMES: Record<number, string> = {
  0: 'heavy',
  25: 'mostly-heavy',
  50: 'balanced',
  75: 'mostly-uplifting',
  100: 'uplifting',
}

function clampToValid(value: number): number {
  // Snap to nearest valid value
  let closest = VALID_VALUES[0]!
  let minDist = Math.abs(value - closest)
  for (const v of VALID_VALUES) {
    const dist = Math.abs(value - v)
    if (dist < minDist) {
      closest = v
      minDist = dist
    }
  }
  return closest
}

/** The mix a `mix` query value names, or null when it is missing or unrecognized. */
export function parseMixParam(raw: string | null): number | null {
  if (raw === null) return null
  const value = raw.trim().toLowerCase()
  for (const [num, name] of Object.entries(MIX_NAMES)) {
    if (name === value) return Number(num)
  }
  if (!/^\d{1,3}$/.test(value)) return null
  const parsed = Number(value)
  return parsed <= 100 ? clampToValid(parsed) : null
}

/** `params` with the `mix` parameter naming `value` (snapped to a position); the other parameters are kept. */
export function withMix(params: URLSearchParams, value: number): URLSearchParams {
  const next = new URLSearchParams(params)
  next.set(MIX_PARAM, MIX_NAMES[clampToValid(value)]!)
  return next
}

/** The dial's far end, "Only uplifting": while the dial is here, the reader is in the Actually Uplifting edition. */
export const UPLIFTING_MIX = 100

/** The edition's landing page, which puts the dial at `UPLIFTING_MIX` as `?mix=uplifting` does. */
export const UPLIFTING_PATH = '/uplifting'

/** Whether `pathname` is the landing page, with or without the trailing slash Render serves it at too. */
export function isUpliftingPath(pathname: string): boolean {
  return pathname === UPLIFTING_PATH || pathname === `${UPLIFTING_PATH}/`
}

/**
 * The stored preference, or balanced. The build's prerenderer never reads it: one browser snapshots
 * every page, and a mix stored by one snapshot must not reach the next.
 */
function readStored(): number {
  if (isPrerendering()) return 50
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored !== null) {
      const parsed = parseInt(stored, 10)
      if (!isNaN(parsed)) return clampToValid(parsed)
    }
  } catch {
    // localStorage unavailable
  }
  return 50
}

export function PositivityProvider({ children }: { children: React.ReactNode }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const { pathname } = useLocation()
  // An explicit ?mix= wins over the landing page's path
  const fromUrl = parseMixParam(searchParams.get(MIX_PARAM)) ?? (isUpliftingPath(pathname) ? UPLIFTING_MIX : null)
  const [positivity, setPositivityRaw] = useState(() => fromUrl ?? readStored())

  // A link carrying ?mix= or to the landing page (on load or on later navigation) sets the mix
  useEffect(() => {
    if (fromUrl !== null) setPositivityRaw(fromUrl)
  }, [fromUrl])

  const setPositivity = (value: number) => {
    const next = clampToValid(value)
    setPositivityRaw(next)
    // Keep the address shareable: the current page's URL reflects the slider
    setSearchParams(prev => withMix(prev, next), { replace: true, preventScrollReset: true })
  }

  useEffect(() => {
    if (isPrerendering()) return
    try {
      localStorage.setItem(STORAGE_KEY, String(positivity))
    } catch {
      // localStorage unavailable
    }
  }, [positivity])

  return <PositivityContext.Provider value={{ positivity, setPositivity }}>{children}</PositivityContext.Provider>
}

export function usePositivity() {
  return useContext(PositivityContext)
}

/** Whether the reader is in the Actually Uplifting edition: the dial at its far end, nothing else. */
export function useUpliftingEdition(): boolean {
  return usePositivity().positivity === UPLIFTING_MIX
}

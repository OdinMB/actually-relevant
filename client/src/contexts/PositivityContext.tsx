import { createContext, useContext, useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'

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

function readStored(): number {
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
  const fromUrl = parseMixParam(searchParams.get(MIX_PARAM))
  const [positivity, setPositivityRaw] = useState(() => fromUrl ?? readStored())

  // A link carrying ?mix= (on load or on later navigation) sets the mix
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

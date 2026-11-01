/**
 * A fresh rating sample next to the spent phase-1 one (pure). eval:models
 * samples it into a new folder (`--assess-size`, `--exclude`); eval:recalibrate
 * then runs the rating checks on it. Steps whose reference data exists only
 * in the phase-1 folder's ledger (dedup labels, phase 1's selection picks, the
 * owner's rating deliverable) know that folder by its fixtures' creation time.
 */
import type { Fixtures } from './fixtures.js'

/** `createdAt` of the phase-1 fixtures in DOCS/2026-09-24_gpt6-eval, frozen since. */
export const PHASE1_FIXTURES_CREATED_AT = '2026-09-24T03:24:31.255Z'
export const PHASE1_FOLDER = 'DOCS/2026-09-24_gpt6-eval'

export const isPhase1Sample = (fx: Pick<Fixtures, 'createdAt'>): boolean => fx.createdAt === PHASE1_FIXTURES_CREATED_AT

/** Fixtures sampled before `--assess-size` existed hold the 50-story target. */
export const LEGACY_ASSESS_SIZE = 50

export interface SampleRequest {
  floor: string
  assessSize: number
  /** Folder names whose stories were left out of the pre-assessment and full-assessment pools. */
  exclude: string[]
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i])

/** Why cached fixtures cannot serve this request (so they are resampled), or null when they can. */
export function fixtureMismatch(fx: Pick<Fixtures, 'floor' | 'assessSize' | 'exclude'>, want: SampleRequest): string | null {
  if (fx.floor !== want.floor) return `cached with floor ${fx.floor ?? 'unrecorded'}, requested ${want.floor}`
  const size = fx.assessSize ?? LEGACY_ASSESS_SIZE
  if (size !== want.assessSize) return `cached with a full-assessment target of ${size}, requested ${want.assessSize}`
  const exclude = fx.exclude ?? []
  if (!sameSet(exclude, want.exclude))
    return `cached excluding ${exclude.length > 0 ? exclude.join(', ') : 'nothing'}, requested excluding ${want.exclude.length > 0 ? want.exclude.join(', ') : 'nothing'}`
  return null
}

/** Every pre-assessment and full-assessment story of the given samples. */
export function excludedIds(samples: { preassess: { id: string }[]; assess: { id: string }[] }[]): Set<string> {
  return new Set(samples.flatMap(s => [...s.preassess, ...s.assess].map(x => x.id)))
}

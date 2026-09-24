/**
 * The owner's blind-rating deliverable: turns drafted items into the exact
 * `rating-sets.json` / `rating-key.json` shape, with per-set caps,
 * deterministic item picking and label order, and a model-name check that
 * covers every string in the file (see blinding.ts).
 */
import { createHash } from 'node:crypto'
import { findModelNames } from './blinding.js'
import type { RatingItemDraft, RatingSetSlug } from './types.js'

export const PROJECT = 'actually-relevant'

/** Owner's rating budget per set. */
export const RATING_BUDGET: Record<RatingSetSlug, number> = {
  'full-assessment': 12,
  'social-post': 10,
  'newsletter-intro': 4,
  'podcast-script': 1,
  'story-selection': 5,
}

export interface RatingOption {
  label: string
  type: 'text' | 'image'
  content_md: string
}

export interface RatingItem {
  id: string
  context_md: string
  options: RatingOption[]
}

export interface RatingSet {
  id: string
  title: string
  instructions: string
  items: RatingItem[]
}

export interface RatingSetsFile {
  project: string
  sets: RatingSet[]
}

/** item ID → label → arm key (`model@effort`). */
export type RatingKey = Record<string, Record<string, string>>

export interface ExcludedDraft {
  set: RatingSetSlug
  key: string
  /** `context`: the story itself mentions a model name (owner's rule); `option`: a model output does. */
  where: 'context' | 'option'
  terms: string[]
}

// ---------------------------------------------------------------------------
// Picking rules (deterministic: hash order within equal priority)
// ---------------------------------------------------------------------------

const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const hashOrder = (drafts: RatingItemDraft[]) => [...drafts].sort((a, b) => (sha(a.key) < sha(b.key) ? -1 : 1))

interface Quota {
  test: (d: RatingItemDraft) => boolean
  min: number
}

function pickWithQuotas(drafts: RatingItemDraft[], cap: number, quotas: Quota[], priority: (d: RatingItemDraft) => number): RatingItemDraft[] {
  const ordered = hashOrder(drafts).sort((a, b) => priority(b) - priority(a))
  const picked: RatingItemDraft[] = []
  for (const q of quotas) {
    let have = picked.filter(q.test).length
    for (const d of ordered) {
      if (have >= q.min || picked.length >= cap) break
      if (!picked.includes(d) && q.test(d)) {
        picked.push(d)
        have++
      }
    }
  }
  for (const d of ordered) {
    if (picked.length >= cap) break
    if (!picked.includes(d)) picked.push(d)
  }
  return picked
}

interface SetSpec {
  title: string
  instructions: string
  pick: (drafts: RatingItemDraft[], cap: number) => RatingItemDraft[]
}

const SET_SPECS: Record<RatingSetSlug, SetSpec> = {
  'full-assessment': {
    title: 'Story assessments',
    instructions: 'Each option is a full analysis of the article shown. Which analysis is more accurate, better supported by the article, and closer to the house format?',
    // Prefer items where the two ratings differ; ≥1 Han-script and ≥3 non-English when available; then the 4-6 band.
    pick: (drafts, cap) => pickWithQuotas(drafts, cap, [
      { test: d => d.tags.han === true, min: 1 },
      { test: d => d.tags.nonEnglish === true, min: 3 },
    ], d => (d.tags.differ ? 2 : 0) + (d.tags.band46 ? 1 : 0)),
  },
  'social-post': {
    title: 'Social post text',
    instructions: 'Each option is the text that would be posted above the story link. Which post would you rather publish unedited?',
    // Half Bluesky, half Mastodon; drafts where either option broke a hard rule first.
    pick: (drafts, cap) => ['bluesky', 'mastodon'].flatMap(p =>
      pickWithQuotas(drafts.filter(d => d.tags.platform === p), Math.floor(cap / 2), [], d => (d.tags.brokeRule ? 1 : 0))),
  },
  'newsletter-intro': {
    title: 'Newsletter intros',
    instructions: 'Each option is the opening paragraph of the same newsletter edition. Which opening is better for this edition?',
    pick: (drafts, cap) => pickWithQuotas(drafts, cap, [], () => 0),
  },
  'podcast-script': {
    title: 'Podcast script',
    instructions: 'Each option is a full script for the same episode. Which script would you rather record?',
    pick: (drafts, cap) => pickWithQuotas(drafts, cap, [], () => 0),
  },
  'story-selection': {
    title: 'Story selection',
    instructions: 'Each option is a set of stories picked from the candidates shown. Which set of picks is the better editorial choice for this group?',
    // Only groups where the two picks differ, most different first; fewer than the cap if fewer differ.
    pick: (drafts, cap) => hashOrder(drafts.filter(d => Number(d.tags.jaccard) < 1))
      .sort((a, b) => Number(a.tags.jaccard) - Number(b.tags.jaccard))
      .slice(0, cap),
  },
}

const SET_ORDER = Object.keys(RATING_BUDGET) as RatingSetSlug[]

export const setIdFor = (slug: RatingSetSlug) => `${PROJECT}-${slug}`

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function labelled(itemId: string, options: RatingItemDraft['options']): { options: RatingOption[]; key: Record<string, string> } {
  const ordered = [...options].sort((a, b) => (sha(`${itemId}:${a.arm}`) < sha(`${itemId}:${b.arm}`) ? -1 : 1))
  const key: Record<string, string> = {}
  const out = ordered.map((o, i) => {
    const label = String.fromCharCode(65 + i)
    key[label] = o.arm
    return { label, type: 'text' as const, content_md: o.content_md }
  })
  return { options: out, key }
}

export function buildRatingDeliverable(drafts: RatingItemDraft[]): { sets: RatingSetsFile; key: RatingKey; excluded: ExcludedDraft[] } {
  const key: RatingKey = {}
  const excluded: ExcludedDraft[] = []
  const sets: RatingSet[] = []
  for (const slug of SET_ORDER) {
    const clean = drafts.filter(d => {
      if (d.set !== slug) return false
      const inContext = findModelNames(d.context_md)
      const inOptions = [...new Set(d.options.flatMap(o => findModelNames(o.content_md)))]
      if (inContext.length > 0) excluded.push({ set: slug, key: d.key, where: 'context', terms: inContext })
      else if (inOptions.length > 0) excluded.push({ set: slug, key: d.key, where: 'option', terms: inOptions })
      return inContext.length === 0 && inOptions.length === 0
    })
    const spec = SET_SPECS[slug]
    const setId = setIdFor(slug)
    const items = spec.pick(clean, RATING_BUDGET[slug]).map((d, i) => {
      const id = `${setId}-${String(i + 1).padStart(2, '0')}`
      const { options, key: itemKey } = labelled(id, d.options)
      key[id] = itemKey
      return { id, context_md: d.context_md, options }
    })
    if (items.length > 0) sets.push({ id: setId, title: spec.title, instructions: spec.instructions, items })
  }
  return { sets: { project: PROJECT, sets }, key, excluded }
}

// ---------------------------------------------------------------------------
// Validate (run on the written files)
// ---------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function exactKeys(v: unknown, keys: string[], path: string, errors: string[]): v is Record<string, unknown> {
  if (!isRecord(v)) {
    errors.push(`${path}: not an object`)
    return false
  }
  const actual = Object.keys(v).sort()
  const expected = [...keys].sort()
  if (actual.join() !== expected.join()) errors.push(`${path}: keys ${actual.join(', ')} (expected ${expected.join(', ')})`)
  return true
}

function validateOption(o: unknown, path: string, errors: string[]): string | null {
  if (!exactKeys(o, ['label', 'type', 'content_md'], path, errors)) return null
  if (o.type !== 'text' && o.type !== 'image') errors.push(`${path}: type ${String(o.type)}`)
  if (typeof o.content_md !== 'string' || o.content_md.trim() === '') errors.push(`${path}: empty content_md`)
  else {
    const leaks = findModelNames(o.content_md)
    if (leaks.length > 0) errors.push(`${path}: model name leak (${leaks.join(', ')})`)
  }
  return typeof o.label === 'string' ? o.label : null
}

function validateItem(item: unknown, index: number, setId: string, key: unknown, errors: string[]): string | null {
  const path = `${setId}[${index}]`
  if (!exactKeys(item, ['id', 'context_md', 'options'], path, errors)) return null
  const expectedId = `${setId}-${String(index + 1).padStart(2, '0')}`
  if (item.id !== expectedId) errors.push(`${path}: id ${String(item.id)} (expected ${expectedId})`)
  if (typeof item.context_md !== 'string') errors.push(`${path}: context_md is not a string`)
  else {
    const leaks = findModelNames(item.context_md)
    if (leaks.length > 0) errors.push(`${path}.context_md: model name leak (${leaks.join(', ')})`)
  }
  if (!Array.isArray(item.options) || item.options.length < 2 || item.options.length > 4) {
    errors.push(`${path}: needs 2-4 options`)
    return typeof item.id === 'string' ? item.id : null
  }
  const labels = item.options.map((o, j) => validateOption(o, `${path}.options[${j}]`, errors))
  if (new Set(labels).size !== labels.length) errors.push(`${path}: duplicate labels`)
  const entry = isRecord(key) && typeof item.id === 'string' ? key[item.id] : undefined
  if (!isRecord(entry)) errors.push(`${path}: missing from the answer key`)
  else if (Object.keys(entry).sort().join() !== labels.filter(Boolean).sort().join()) errors.push(`${path}: answer-key labels do not match options`)
  return typeof item.id === 'string' ? item.id : null
}

function validateSet(set: unknown, index: number, key: unknown, errors: string[]): string[] {
  const path = `sets[${index}]`
  if (!exactKeys(set, ['id', 'title', 'instructions', 'items'], path, errors)) return []
  const slug = SET_ORDER.find(s => setIdFor(s) === set.id)
  if (!slug) errors.push(`${path}: unknown set id ${String(set.id)}`)
  for (const field of ['id', 'title', 'instructions'] as const) {
    const value = set[field]
    if (typeof value !== 'string' || value.trim() === '') errors.push(`${path}: empty ${field}`)
    else if (findModelNames(value).length > 0) errors.push(`${path}: model name in ${field}`)
  }
  if (!Array.isArray(set.items)) {
    errors.push(`${path}: items is not an array`)
    return []
  }
  if (slug && set.items.length > RATING_BUDGET[slug]) errors.push(`${path}: ${set.items.length} items > cap ${RATING_BUDGET[slug]}`)
  return set.items.flatMap((item, j) => {
    const id = validateItem(item, j, String(set.id), key, errors)
    if (id && findModelNames(id).length > 0) errors.push(`${path}.items[${j}]: model name in id`)
    return id ? [id] : []
  })
}

/** Every problem with a written deliverable; empty when it is valid. */
export function validateRatingDeliverable(sets: unknown, key: unknown): string[] {
  const errors: string[] = []
  if (!exactKeys(sets, ['project', 'sets'], 'rating-sets.json', errors)) return errors
  if (sets.project !== PROJECT) errors.push(`project is ${String(sets.project)}`)
  if (!Array.isArray(sets.sets)) return [...errors, 'sets is not an array']
  const ids = sets.sets.flatMap((s, i) => validateSet(s, i, key, errors))
  if (!isRecord(key)) return [...errors, 'rating-key.json is not an object']
  for (const id of Object.keys(key)) if (!ids.includes(id)) errors.push(`rating-key.json: ${id} is not an item`)
  return errors
}

/**
 * The duplicate groups (ADR-0076; `.context/model-eval.md`, "Deduplicated inputs"): stories that are two
 * reports of one event or one study, which production's duplicate detection would have merged, so the
 * linking replays feed them as production would have had them, one story. The committed file
 * `duplicates.json` sits beside `keys/` (not in it: every `*.json` there is read as an answer key) and
 * names each group's `keep` (the earliest published, the earliest crawled breaking a tie, as production's
 * duplicate detection elects its primary) and its `drop`s, with a line of why and the audit's confidence.
 * Here: the file's format, its rules against the keys (`duplicateErrors`, held by `keys.test.ts` with no
 * database and by the `keys` step), applying it to the keys before any step reads them
 * (`mergeDuplicates`), and reading a saved replay made before a group existed as its keeps
 * (`runAsKeeps`). Pure, but for reading the file.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import type { AnswerKey } from './keySchema.js'
import type { SavedLinkRun } from './savedLinkReplay.js'

export const DUPLICATES_FILE = join(dirname(fileURLToPath(import.meta.url)), 'duplicates.json')

/** Production's duplicate detection compares stories published within this many days of each other (`.context/dedup.md`). */
export const DEDUP_WINDOW_DAYS = 14

const groupSchema = z.object({
  keep: z.string().min(1).describe('The slug that stands for the group: the earliest published, the earliest crawled breaking a tie.'),
  drop: z.array(z.string().min(1)).min(1).describe('The slugs production would have merged into the keep.'),
  why: z.string().min(1).describe('One line: the one event or study they all report.'),
  confidence: z.enum(['high', 'medium-high', 'medium']).describe("The audit's confidence that they are one event; lower ones are left out."),
})

const fileSchema = z.object({
  about: z.string().default(''),
  groups: z.array(groupSchema),
})

export type DuplicateGroup = z.infer<typeof groupSchema>

/** The committed groups, or the file's format errors; no file is no group. */
export function readDuplicateGroups(path: string = DUPLICATES_FILE): { groups: DuplicateGroup[]; errors: string[] } {
  if (!existsSync(path)) return { groups: [], errors: [] }
  let json: unknown
  try {
    json = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    return { groups: [], errors: [`duplicates.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`] }
  }
  const parsed = fileSchema.safeParse(json)
  if (!parsed.success) return { groups: [], errors: parsed.error.issues.map(i => `duplicates.json ${i.path.join('.')}: ${i.message}`) }
  return { groups: parsed.data.groups, errors: [] }
}

type Entry = AnswerKey['entries'][number]
type NearMiss = AnswerKey['nearMisses'][number]

/** Every story the keys name, with the date and title they give it (entries first, then near misses). */
function namedStories(keys: readonly AnswerKey[]): Map<string, { date: string; title: string }> {
  const named = new Map<string, { date: string; title: string }>()
  for (const k of keys) {
    for (const x of [...k.entries, ...k.centers.flatMap(c => c.entries), ...k.nearMisses, ...k.centers.flatMap(c => c.nearMisses)]) {
      if (!named.has(x.slug)) named.set(x.slug, { date: x.date, title: x.title })
    }
  }
  return named
}

const DAY_MS = 86_400_000
const daysApart = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS

/** A key's entry slugs and near-miss slugs, its centers' included. */
const sidesOf = (k: AnswerKey) => ({
  entries: new Set([...k.entries, ...k.centers.flatMap(c => c.entries)].map(e => e.slug)),
  nearMisses: new Set([...k.nearMisses, ...k.centers.flatMap(c => c.nearMisses)].map(n => n.slug)),
})

/**
 * The groups' errors against the keys; empty when they hold: every slug named by a key; a keep never a
 * drop and no slug in two groups; the drops within production's window of their keep, by the keys'
 * dates; and in one key, never a keep and its drop on opposite sides (one an entry, the other a near
 * miss), which would say they are not one event; and a key's `occurrences` naming no drop, nor two
 * stories of one group (a second occurrence that duplicates the first is none). The `keys` step adds
 * that every slug is published.
 */
export function duplicateErrors(groups: readonly DuplicateGroup[], keys: readonly AnswerKey[]): string[] {
  const errors: string[] = []
  const named = namedStories(keys)
  const seen = new Set<string>()
  for (const g of groups) {
    const slugs = [g.keep, ...g.drop]
    for (const s of new Set(slugs)) {
      if (!named.has(s)) errors.push(`duplicates: ${s} is named by no key`)
      if (seen.has(s)) errors.push(`duplicates: ${s} is in two groups`)
      seen.add(s)
    }
    if (g.drop.includes(g.keep)) errors.push(`duplicates: ${g.keep} is both the keep and a drop`)
    const keep = named.get(g.keep)
    for (const d of g.drop) {
      const drop = named.get(d)
      if (keep && drop && daysApart(keep.date, drop.date) > DEDUP_WINDOW_DAYS)
        errors.push(`duplicates: ${d} (${drop.date}) is more than ${DEDUP_WINDOW_DAYS} days from its keep ${g.keep} (${keep.date})`)
    }
  }
  const groupOf = new Map(groups.flatMap(g => [g.keep, ...g.drop].map(s => [s, g] as const)))
  for (const k of keys) {
    if (k.occurrences) {
      const { first, second } = k.occurrences
      for (const s of [first, second]) {
        const g = groupOf.get(s)
        if (g && g.keep !== s) errors.push(`duplicates: ${k.id}'s occurrences name ${s}, a drop of ${g.keep}: name the keep`)
      }
      if (groupOf.has(first) && groupOf.get(first) === groupOf.get(second))
        errors.push(`duplicates: ${k.id}'s occurrences name ${first} and ${second}, two stories of one group: they are one occurrence`)
    }
    const { entries, nearMisses } = sidesOf(k)
    for (const g of groups)
      for (const d of g.drop) {
        if ((entries.has(g.keep) && nearMisses.has(d)) || (nearMisses.has(g.keep) && entries.has(d)))
          errors.push(`duplicates: in ${k.id}, the keep ${g.keep} and its drop ${d} are on opposite sides (one an entry, the other a near miss)`)
      }
  }
  return errors
}

/** Each slug as the replay reads it: a drop as its keep, any other slug as itself. */
export function keepOf(groups: readonly DuplicateGroup[]): (slug: string) => string {
  const keeps = new Map(groups.flatMap(g => g.drop.map(d => [d, g.keep] as const)))
  return slug => keeps.get(slug) ?? slug
}

const JOIN_RANK = { optional: 0, must: 1 } as const

/** One list of entries and near misses with the groups merged, `holds` the slugs the key holds (updated as a keep takes a drop's place). */
function mergeLists(
  entries: readonly Entry[],
  nearMisses: readonly NearMiss[],
  groups: readonly DuplicateGroup[],
  named: ReadonlyMap<string, { date: string; title: string }>,
  holds: Set<string>,
): { entries: Entry[]; nearMisses: NearMiss[] } {
  const groupOfDrop = new Map(groups.flatMap(g => g.drop.map(d => [d, g] as const)))
  const groupOfKeep = new Map(groups.map(g => [g.keep, g] as const))
  /** The strongest join a group's stories have among these entries. */
  const strongest = (g: DuplicateGroup): Entry['join'] =>
    entries.filter(e => e.slug === g.keep || g.drop.includes(e.slug)).some(e => e.join === 'must') ? 'must' : 'optional'
  const merged: Entry[] = []
  for (const e of entries) {
    const g = groupOfDrop.get(e.slug)
    if (g) {
      if (holds.has(g.keep)) continue
      const keep = named.get(g.keep)
      // The drop's label under the keep's slug, date and title; its values and statuses quote the drop's words, so none
      merged.push({ ...e, slug: g.keep, date: keep?.date ?? e.date, title: keep?.title ?? e.title, join: strongest(g), values: [], statuses: [] })
      holds.add(g.keep)
      continue
    }
    const own = groupOfKeep.get(e.slug)
    merged.push(own && JOIN_RANK[strongest(own)] > JOIN_RANK[e.join] ? { ...e, join: strongest(own) } : e)
  }
  const near: NearMiss[] = []
  for (const n of nearMisses) {
    const g = groupOfDrop.get(n.slug)
    if (!g) near.push(n)
    else if (!holds.has(g.keep)) {
      const keep = named.get(g.keep)
      near.push({ ...n, slug: g.keep, date: keep?.date ?? n.date, title: keep?.title ?? n.title })
      holds.add(g.keep)
    }
  }
  return {
    entries: merged
      .map((e, i) => ({ e, i }))
      .sort((a, b) => a.e.date.localeCompare(b.e.date) || a.i - b.i)
      .map(x => x.e),
    nearMisses: near,
  }
}

/**
 * The keys as production would have had their stories, every key alike: each dropped story removed;
 * where a key holds the keep, its own entry or near miss stands, an entry's `join` raised to the
 * strongest its group had there (`must` over `optional`); where it holds a drop but not the keep, the
 * keep takes the drop's place, with the drop's label (join, role, kind, either role, why) under the
 * keep's slug, date and title and no values or statuses (their quotes are the drop's words; the linking
 * steps read neither), a dropped near miss becoming the keep as a near miss. A response that names a
 * drop names its keep.
 */
export function mergeDuplicates(keys: readonly AnswerKey[], groups: readonly DuplicateGroup[]): AnswerKey[] {
  if (groups.length === 0) return [...keys]
  const named = namedStories(keys)
  const keep = keepOf(groups)
  return keys.map(k => {
    const holds = new Set(namedStories([k]).keys())
    const base = mergeLists(k.entries, k.nearMisses, groups, named, holds)
    const responses = k.responses.map(r => (r.slug ? { ...r, slug: keep(r.slug) } : r))
    const centers = k.centers.map(c => ({
      ...c,
      ...mergeLists(c.entries, c.nearMisses, groups, named, holds),
      responses: c.responses.map(r => (r.slug ? { ...r, slug: keep(r.slug) } : r)),
    }))
    return { ...k, ...base, responses, centers }
  })
}

/** A merged group as the report shows it: the keep, each drop with what the keys made of it, the why. */
export interface MergedGroup {
  keep: string
  drops: { slug: string; as: string[] }[]
  why: string
  confidence: DuplicateGroup['confidence']
}

/** The groups with a story in `keys` (as written, before merging), each drop with the keys and roles it had there. */
export function mergedGroups(groups: readonly DuplicateGroup[], keys: readonly AnswerKey[]): MergedGroup[] {
  const asIn = (slug: string): string[] =>
    keys.flatMap(k => {
      const e = [...k.entries, ...k.centers.flatMap(c => c.entries)].find(x => x.slug === slug)
      if (e) return [`${k.id}: ${e.join} ${e.role.replace('_', ' ')}`]
      return [...k.nearMisses, ...k.centers.flatMap(c => c.nearMisses)].some(n => n.slug === slug) ? [`${k.id}: near miss`] : []
    })
  return groups.flatMap(g => {
    const drops = g.drop.map(slug => ({ slug, as: asIn(slug) })).filter(d => d.as.length > 0)
    return drops.length > 0 ? [{ keep: g.keep, drops, why: g.why, confidence: g.confidence }] : []
  })
}

/**
 * A saved run made before a group existed, read as its keeps (ADR-0076): every slug a drop, as its keep;
 * a story in one overview once (a member and its keep in one overview count once, and a drop whose keep
 * sits in another overview is left out, as production would have had one story); the keep's own role
 * and trace standing over its drop's. For a run made after, it changes nothing.
 */
export function runAsKeeps(run: SavedLinkRun, keep: (slug: string) => string): SavedLinkRun {
  const placed = new Set(run.overviews.flatMap(o => o.members.filter(m => keep(m) === m)))
  const overviews = run.overviews.map(o => {
    const members: string[] = []
    for (const m of o.members) {
      const k = keep(m)
      if (members.includes(k)) continue
      if (k !== m && placed.has(k) && !o.members.includes(k)) continue
      members.push(k)
      placed.add(k)
    }
    return { ...o, foundedFrom: [keep(o.foundedFrom[0]), keep(o.foundedFrom[1])] as [string, string], members }
  })
  /** Each slug's own row first, then a drop's for a keep that has none. */
  const ownFirst = <T>(rows: readonly T[], slugOf: (x: T) => string, rename: (x: T, slug: string) => T): T[] => {
    const own = rows.filter(x => keep(slugOf(x)) === slugOf(x))
    const have = new Set(own.map(slugOf))
    const borrowed: T[] = []
    for (const x of rows) {
      const k = keep(slugOf(x))
      if (k === slugOf(x) || have.has(k)) continue
      have.add(k)
      borrowed.push(rename(x, k))
    }
    return [...own, ...borrowed]
  }
  const renameCandidates = (cs: SavedLinkRun['traces'][number]['partners']) => cs.map(c => ({ ...c, id: keep(c.id) }))
  return {
    ...run,
    overviews,
    roles: ownFirst(
      run.roles,
      ([slug]) => slug,
      ([, role], slug) => [slug, role],
    ),
    traces: ownFirst(
      run.traces,
      t => t.slug,
      (t, slug) => ({ ...t, slug }),
    ).map(t => ({
      ...t,
      partners: renameCandidates(t.partners),
      founding: t.founding ? { ...t.founding, partner: keep(t.founding.partner) } : null,
    })),
    signals: run.signals.map(s => ({ ...s, slug: keep(s.slug) })),
  }
}

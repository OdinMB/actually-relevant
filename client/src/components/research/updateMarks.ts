import type { PublicStoryUpdate } from '@shared/types'

/**
 * Which paragraphs and points of a researched story carry an "Updated" mark (ADR-0068, "Where
 * Updates show"): every one an Update rewrote, by its index on the page now. The Updates name a
 * section by where it was before each update, so they are replayed oldest first: an update that
 * removed a section takes its mark away and moves the marks after it in the same part up one. The
 * headline and the key quote carry no mark. A first pass on a story published before it was
 * researched lists the opening paragraph and the earlier bullets, so those are marked.
 */

export interface UpdateMarks {
  paragraphs: ReadonlySet<number>
  whyThisMatters: ReadonlySet<number>
  caveats: ReadonlySet<number>
}

type Part = keyof UpdateMarks

const PARTS: { part: Part; label: RegExp }[] = [
  { part: 'paragraphs', label: /^Story paragraph (\d+)$/ },
  { part: 'whyThisMatters', label: /^Why This Matters (\d+)$/ },
  { part: 'caveats', label: /^Caveat (\d+)$/ },
]

export function updateMarks(updates: PublicStoryUpdate[]): UpdateMarks {
  const marks: Record<Part, Set<number>> = { paragraphs: new Set(), whyThisMatters: new Set(), caveats: new Set() }
  for (const update of [...updates].reverse()) {
    for (const { part, label } of PARTS) {
      const changed = update.changes.flatMap(c => {
        const n = label.exec(c.section)?.[1]
        return n ? [{ index: Number(n) - 1, removed: c.removed }] : []
      })
      const gone = changed.filter(c => c.removed).map(c => c.index)
      const now = (index: number) => index - gone.filter(g => g < index).length
      const kept = [...marks[part]].filter(index => !gone.includes(index)).map(now)
      marks[part] = new Set([...kept, ...changed.filter(c => !c.removed).map(c => now(c.index))])
    }
  }
  return marks
}

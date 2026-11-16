/**
 * A story's text as story context reads it (`.context/story-context.md`, "Places"): its paragraphs
 * (`P1`…), its Why This Matters points (`W1`…) and its caveats, each paragraph and point with the
 * URLs of the sources it cites. A researched story's come from `stories.research`; a single-source
 * story's from its summary (one paragraph, as the story page shows it), and from its reasons and
 * antifactors split as the page splits them (`client/src/lib/parse-points.ts`), each citing the
 * story's own article. Pure.
 */
import { researchedStorySchema } from './researchedStory.js'

export interface LayoutItem {
  /** `P2`, `W1`. */
  id: string
  text: string
  sourceUrls: string[]
}

export interface StoryLayout {
  paragraphs: LayoutItem[]
  points: LayoutItem[]
  caveats: string[]
}

export interface LayoutStory {
  url: string
  summary: string | null
  relevanceReasons: string | null
  antifactors: string | null
  research: unknown
}

/**
 * The client's `parsePoints`, mirrored so the ids name what the page shows: a Markdown list split on
 * its items (continuation lines joined), else on blank lines, else on newlines.
 */
export function parsePoints(text: string): string[] {
  const lines = text.split('\n')
  if (lines.some(l => /^\s*[-*]\s+/.test(l))) {
    const points: string[] = []
    for (const line of lines) {
      if (/^\s*[-*]\s+/.test(line)) points.push(line.replace(/^\s*[-*]\s+/, '').trim())
      else if (points.length > 0 && line.trim()) points[points.length - 1] += ' ' + line.trim()
    }
    return points.filter(p => p.length > 0)
  }
  const paragraphs = text.split(/\n\s*\n/)
  if (paragraphs.length > 1) return paragraphs.map(p => p.trim()).filter(p => p.length > 0)
  return lines.map(l => l.trim()).filter(l => l.length > 0)
}

const points = (text: string | null) => (text ? parsePoints(text) : [])

export function storyLayout(story: LayoutStory): StoryLayout {
  const research = researchedStorySchema.safeParse(story.research)
  if (research.success) {
    const urlOf = new Map(research.data.sources.flatMap(s => (s.url ? [[s.id, s.url] as const] : [])))
    const cited = (c: { citations: { sourceId: string }[] }[]) => [...new Set(c.flatMap(t => t.citations.flatMap(ci => urlOf.get(ci.sourceId) ?? [])))]
    return {
      paragraphs: research.data.paragraphs.map((p, i) => ({ id: `P${i + 1}`, text: p.sentences.map(s => s.text).join(' '), sourceUrls: cited(p.sentences) })),
      points: research.data.whyThisMatters.map((w, i) => ({ id: `W${i + 1}`, text: w.text, sourceUrls: cited([w]) })),
      caveats: research.data.caveats.map(c => c.text),
    }
  }
  const own = [story.url]
  return {
    paragraphs: story.summary ? [{ id: 'P1', text: story.summary, sourceUrls: own }] : [],
    points: points(story.relevanceReasons).map((text, i) => ({ id: `W${i + 1}`, text, sourceUrls: own })),
    caveats: points(story.antifactors),
  }
}

/** The ids of the paragraphs and points the story has now: a stored place outside them falls back to the section. */
export const layoutSpots = (layout: Pick<StoryLayout, 'paragraphs' | 'points'>): Set<string> => new Set([...layout.paragraphs, ...layout.points].map(i => i.id))

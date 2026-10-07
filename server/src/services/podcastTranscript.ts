/**
 * The readable transcript of a published episode for its public transcript page, without I/O: the
 * episode as it was spoken (the kind's code-added opener and sign-off included), one entry per
 * segment with the frozen story it is about, each turn under its generic host name with the audio
 * tags left out. The VTT reads the same turns the same way (`podcastChunks.ts`).
 */
import type { PodcastKind } from '@prisma/client'
import type { PodcastDialogue } from '../schemas/llm.js'
import { SPEAKER_LABEL, readableText } from './podcastChunks.js'
import { assembleSpokenSegments } from './podcastDialogue.js'
import type { EpisodeStory } from './podcastScript.js'

export interface PublicTranscriptTurn {
  speaker: (typeof SPEAKER_LABEL)[keyof typeof SPEAKER_LABEL]
  text: string
}

export interface PublicTranscriptSegment {
  /** The story a story segment is about; null for the opener, intro, outro and sign-off. */
  story: { title: string; publisher: string; sourceUrl: string; slug: string | null } | null
  turns: PublicTranscriptTurn[]
}

function hasSegments(dialogue: unknown): dialogue is PodcastDialogue {
  return typeof dialogue === 'object' && dialogue !== null && Array.isArray((dialogue as { segments?: unknown }).segments)
}

/** The published episode's transcript; empty when no dialogue is stored. */
export function publicTranscript(dialogue: unknown, kind: PodcastKind, stories: EpisodeStory[]): PublicTranscriptSegment[] {
  if (!hasSegments(dialogue)) return []
  const byRef = new Map(stories.map(s => [s.ref, s]))
  return assembleSpokenSegments(dialogue, kind).flatMap(segment => {
    const turns = segment.turns
      .map(t => ({ speaker: SPEAKER_LABEL[t.speaker], text: readableText(t.text) }))
      .filter(t => t.text !== '')
    if (turns.length === 0) return []
    const s = segment.storyRef == null ? undefined : byRef.get(segment.storyRef)
    const story = s ? { title: s.title, publisher: s.publisher, sourceUrl: s.sourceUrl, slug: s.slug } : null
    return [{ story, turns }]
  })
}

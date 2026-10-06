/**
 * Dialogue rules and transformations for the two-speaker podcast, without I/O: validation of the
 * model's dialogue (including the segue rule), the spoken episode with the code-added opener and
 * sign-off, and the admin script view.
 */
import { config } from '../config.js'
import { PODCAST_OPENER } from '../lib/aiLabelCopy.js'
import { PODCAST_AUDIO_TAGS, type PodcastDialogue } from '../schemas/llm.js'

export type Speaker = 'HOST_A' | 'HOST_B'

export interface Turn {
  speaker: Speaker
  text: string
}

export interface SpokenSegment {
  kind: 'opener' | 'intro' | 'story' | 'outro' | 'signoff'
  storyRef: number | null
  turns: Turn[]
}

/** What validation needs to know about each story of the episode. */
export interface DialogueStoryRef {
  ref: number
  title: string
  /** Display name; a publisher named like a domain ("Phys.org") is not a URL. */
  publisher: string
}

export interface DialogueValidation {
  valid: boolean
  errors: string[]
}

/** Spoken last turn of every episode (HOST_A), added in code after the model's outro. */
export const PODCAST_SIGN_OFF = "That's it for this week. Tell us what you think on actuallyrelevant.news. Thanks for listening."

const CODE_TURN_CHARS = PODCAST_OPENER.length + PODCAST_SIGN_OFF.length

/** The characters the model's own turns may take, so the whole episode stays inside the band. */
export function dialogueCharBudget(): { min: number; max: number } {
  const [lo, hi] = config.podcast.spokenCharBand
  return { min: lo - CODE_TURN_CHARS, max: hi - CODE_TURN_CHARS }
}

/** The episode as it is spoken: the opener, the model's segments, the sign-off. */
export function assembleSpokenSegments(dialogue: PodcastDialogue): SpokenSegment[] {
  return [
    { kind: 'opener', storyRef: null, turns: [{ speaker: 'HOST_A', text: PODCAST_OPENER }] },
    ...dialogue.segments.map(s => ({ kind: s.kind, storyRef: s.storyRef, turns: s.turns.map(t => ({ speaker: t.speaker, text: t.text })) })),
    { kind: 'signoff', storyRef: null, turns: [{ speaker: 'HOST_A', text: PODCAST_SIGN_OFF }] },
  ]
}

/** The admin's read-only script view: "HOST A: …" per turn, a blank line between segments. */
export function renderScript(segments: SpokenSegment[]): string {
  return segments
    .map(s => s.turns.map(t => `${t.speaker === 'HOST_A' ? 'HOST A' : 'HOST B'}: ${t.text}`).join('\n'))
    .join('\n\n')
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const TAG_RE = /\[[^\]\n]{1,40}\]/g
const URL_RE = /https?:\/\/|www\.|\b[\w-]+\.(?:com|org|net|news|io|gov|edu|info)\b/i
const MARKDOWN_RE = /[*_#`]|^\s*[-•]\s/m
const PREFIX_RE = /^\s*(?:host|speaker)(?:[\s_-]*[a-z0-9]+)?\s*:/i

const stripTags = (text: string) => text.replace(TAG_RE, ' ').replace(/\s+/g, ' ').trim()
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** URL check that lets the episode's own publisher names through, since every story names its publisher. */
function urlChecker(stories: DialogueStoryRef[]): (text: string) => boolean {
  const names = stories.map(s => s.publisher.trim()).filter(p => p !== '').map(escapeRegExp)
  const publisherRe = names.length > 0 ? new RegExp(names.join('|'), 'gi') : null
  return text => URL_RE.test(publisherRe ? text.replace(publisherRe, ' ') : text)
}
const normalize = (text: string) => stripTags(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const firstWords = (text: string, n: number) => normalize(text).split(' ').slice(0, n).join(' ')

function label(segment: PodcastDialogue['segments'][number], index: number): string {
  return segment.kind === 'story' ? `segment ${index + 1} (story ${segment.storyRef})` : `segment ${index + 1} (${segment.kind})`
}

/**
 * The intro is one HOST_A welcome that leads into the first story (owner, 2026-10-06). With the
 * HOST_A opener before it, the first story segment then has to open with HOST_B, which the
 * speaker-run rule enforces.
 */
function introErrors(intro: PodcastDialogue['segments'][number] | undefined): string[] {
  if (intro?.kind !== 'intro') return []
  const errors: string[] = []
  if (intro.turns.length > 1) errors.push(`the intro has ${intro.turns.length} turns; it must be one turn, a HOST_A welcome that leads into the first story`)
  if (intro.turns.some(t => t.speaker !== 'HOST_A')) errors.push('the intro must be spoken by HOST_A only; HOST_B first speaks in the first story segment')
  return errors
}

function structureErrors(dialogue: PodcastDialogue, stories: DialogueStoryRef[]): string[] {
  const segs = dialogue.segments
  const errors: string[] = []
  if (segs[0]?.kind !== 'intro') errors.push('the dialogue must start with one intro segment')
  if (segs.at(-1)?.kind !== 'outro') errors.push('the dialogue must end with one outro segment')
  segs.forEach((s, i) => {
    if (s.kind === 'intro' && i !== 0) errors.push(`${label(s, i)}: only the first segment may be the intro`)
    if (s.kind === 'outro' && i !== segs.length - 1) errors.push(`${label(s, i)}: only the last segment may be the outro`)
    if (s.kind !== 'story' && s.storyRef !== null) errors.push(`${label(s, i)}: storyRef must be null`)
    if (s.turns.length === 0) errors.push(`${label(s, i)}: has no turns`)
  })

  errors.push(...introErrors(segs[0]))

  const known = new Set(stories.map(s => s.ref))
  const covered = segs.filter(s => s.kind === 'story').map(s => s.storyRef)
  for (const ref of covered) {
    if (ref === null || !known.has(ref)) errors.push(`a story segment refers to story ${ref}, which is not in this episode`)
  }
  for (const { ref } of stories) {
    const n = covered.filter(r => r === ref).length
    if (n !== 1) errors.push(`story ${ref} is covered ${n} times; every story exactly once`)
  }
  return errors
}

function metadataErrors(dialogue: PodcastDialogue, hasUrl: (text: string) => boolean): string[] {
  const max = config.podcast.maxTitleChars
  const title = dialogue.episodeTitle.trim()
  const errors: string[] = []
  if (title === '') errors.push('the episode title is empty')
  if (title.length > max) errors.push(`the episode title has ${title.length} characters, over the ${max}-character limit`)
  for (const [name, text] of [['title', dialogue.episodeTitle], ['summary', dialogue.episodeSummary]] as const) {
    if (hasUrl(text)) errors.push(`the episode ${name} contains a URL`)
    if (MARKDOWN_RE.test(text)) errors.push(`the episode ${name} contains markdown`)
  }
  return errors
}

function turnErrors(dialogue: PodcastDialogue, hasUrl: (text: string) => boolean): string[] {
  const allowed = new Set<string>(PODCAST_AUDIO_TAGS)
  return dialogue.segments.flatMap((s, i) => s.turns.flatMap((t, j) => {
    const where = `${label(s, i)}, turn ${j + 1}`
    const tags = t.text.match(TAG_RE) ?? []
    const plain = stripTags(t.text)
    return [
      ...(t.text.length > config.podcast.maxTurnChars ? [`${where}: ${t.text.length} characters, over the ${config.podcast.maxTurnChars}-character limit`] : []),
      ...tags.filter(tag => !allowed.has(tag)).map(tag => `${where}: audio tag ${tag} is not allowed`),
      ...(tags.length > config.podcast.maxTagsPerTurn ? [`${where}: ${tags.length} audio tags, at most ${config.podcast.maxTagsPerTurn}`] : []),
      ...(hasUrl(plain) ?[`${where}: contains a URL`] : []),
      ...(MARKDOWN_RE.test(plain) ? [`${where}: contains markdown`] : []),
      ...(PREFIX_RE.test(plain) ? [`${where}: starts with a speaker prefix`] : []),
    ]
  }))
}

/** The segue rule: every segment after the intro opens with a real spoken bridge, never templated. */
function segueErrors(dialogue: PodcastDialogue, stories: DialogueStoryRef[]): string[] {
  const headline = new Map(stories.map(s => [s.ref, normalize(s.title)]))
  const errors: string[] = []
  let previousStoryOpening: string | null = null
  dialogue.segments.forEach((s, i) => {
    if (s.kind === 'intro' || s.turns.length === 0) return
    const opening = s.turns[0].text
    const plain = stripTags(opening)
    const title = s.storyRef === null ? undefined : headline.get(s.storyRef)
    const restated = title !== undefined && title !== '' && (normalize(opening) === title || title.includes(normalize(opening)))
    if (plain.length < config.podcast.minBridgeChars || restated) {
      errors.push(`${label(s, i)}: the first turn must carry a spoken bridge of at least ${config.podcast.minBridgeChars} characters that is not just the headline`)
    }
    if (s.kind !== 'story') return
    const words = firstWords(opening, 5)
    if (previousStoryOpening !== null && words === previousStoryOpening) {
      errors.push(`${label(s, i)}: opens with the same first five words as the story before ("${words}")`)
    }
    previousStoryOpening = words
  })
  return errors
}

function speakerRunErrors(spoken: SpokenSegment[]): string[] {
  const turns = spoken.flatMap(s => s.turns)
  for (let i = 2; i < turns.length; i++) {
    if (turns[i].speaker === turns[i - 1].speaker && turns[i].speaker === turns[i - 2].speaker) {
      return [`${turns[i].speaker} speaks three times in a row (spoken turn ${i + 1}, opener included); at most twice`]
    }
  }
  return []
}

/**
 * The band covers the whole spoken episode; the error speaks in the prompt's terms (the model's own
 * turns against its budget), so the regeneration knows exactly how far to move.
 */
function bandErrors(spoken: SpokenSegment[], dialogue: PodcastDialogue): string[] {
  const [lo, hi] = config.podcast.spokenCharBand
  const total = spoken.flatMap(s => s.turns).reduce((n, t) => n + t.text.length, 0)
  if (total >= lo && total <= hi) return []
  const own = dialogue.segments.flatMap(s => s.turns).reduce((n, t) => n + t.text.length, 0)
  const { min, max } = dialogueCharBudget()
  return [`your turns total ${own} spoken characters, audio tags included; they must total ${min} to ${max}`]
}

/** Every rule the dialogue must meet before it is stored; the errors are fed back on the one regeneration. */
export function validateDialogue(dialogue: PodcastDialogue, stories: DialogueStoryRef[]): DialogueValidation {
  const spoken = assembleSpokenSegments(dialogue)
  const hasUrl = urlChecker(stories)
  const errors = [
    ...metadataErrors(dialogue, hasUrl),
    ...structureErrors(dialogue, stories),
    ...turnErrors(dialogue, hasUrl),
    ...segueErrors(dialogue, stories),
    ...speakerRunErrors(spoken),
    ...bandErrors(spoken, dialogue),
  ]
  return { valid: errors.length === 0, errors }
}

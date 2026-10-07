/**
 * Dialogue rules and transformations for the two-speaker podcast, without I/O: validation of the
 * model's dialogue (including the segue rule, the outro's no-sign-off rule, and for a standalone episode the rule against dating
 * stories relative to now), the spoken episode with the kind's code-added opener and sign-off, the
 * admin script view, and a person's text edits applied to the stored structure.
 */
import type { PodcastKind } from '@prisma/client'
import { config } from '../config.js'
import { podcastOpener, podcastSignOff } from '../lib/aiLabelCopy.js'
import type { PodcastCharBudget } from '../prompts/podcast.js'
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
  /** Rules the dialogue breaks; any error keeps it from being stored. */
  errors: string[]
  /** Rules a person's text may break deliberately (the style rules); reported, never blocking. */
  warnings: string[]
}

export interface ValidationOptions {
  /** The episode's kind: its spoken opener and sign-off, its length budget, and its wording rules. */
  kind: PodcastKind
  /**
   * `person`: the style rules (the segue rules and the outro's no-sign-off rule) become warnings,
   * since a person may write a short bridge or a closing line on purpose and hears the result
   * before publishing. Every other rule protects TTS spend, chunking or the feed and stays an
   * error. Default `model`.
   */
  authoredBy?: 'model' | 'person'
}

/**
 * The characters the model's own turns may take, so the whole episode stays inside the band, and
 * the length the prompt asks them for. The code turns' length depends on the kind's wording.
 */
export function dialogueCharBudget(kind: PodcastKind): PodcastCharBudget {
  const codeTurnChars = podcastOpener(kind).length + podcastSignOff(kind).length
  const [lo, hi] = config.podcast.spokenCharBand
  return { min: lo - codeTurnChars, max: hi - codeTurnChars, aim: config.podcast.spokenCharAim - codeTurnChars }
}

/** The episode as it is spoken: the kind's opener, the model's segments, the kind's sign-off. */
export function assembleSpokenSegments(dialogue: PodcastDialogue, kind: PodcastKind): SpokenSegment[] {
  return [
    { kind: 'opener', storyRef: null, turns: [{ speaker: 'HOST_A', text: podcastOpener(kind) }] },
    ...dialogue.segments.map(s => ({ kind: s.kind, storyRef: s.storyRef, turns: s.turns.map(t => ({ speaker: t.speaker, text: t.text })) })),
    { kind: 'signoff', storyRef: null, turns: [{ speaker: 'HOST_A', text: podcastSignOff(kind) }] },
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

/**
 * URL check that lets the episode's own publisher names through, since every story names its publisher.
 * A name is let through only as a standalone token: not inside another word ("cap.com" for "AP") and
 * not extended by a domain suffix or path ("reuters.com/world" for "Reuters"), so a spoken domain built
 * from a publisher's name is still caught. A sentence-ending period after the name ("Vox.com.") is fine.
 */
function urlChecker(stories: DialogueStoryRef[]): (text: string) => boolean {
  const names = stories.map(s => s.publisher.trim()).filter(p => p !== '').map(escapeRegExp)
  const publisherRe = names.length > 0 ? new RegExp(`(?<![\\w.\\-/@])(?:${names.join('|')})(?![\\w\\-/@]|\\.\\w)`, 'gi') : null
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

/**
 * A closing thank-you or sign-off: thanks to the listeners ("Thanks for listening", "Thank you,
 * everyone") or a goodbye line. Thanks for something else ("thanks to that court") is not one.
 */
const CLOSING_RE = new RegExp([
  String.raw`\b(?:thanks|thank you)(?: (?:so|very) much)?,? (?:for (?:listening|joining|tuning in|spending|being (?:here|with)|your time|having)|(?:to )?(?:you|everyone|all|listeners|folks)\b)`,
  String.raw`\b(?:thanks|thank you)(?: (?:so|very) much)?[.!]`,
  String.raw`\b(?:see you (?:next|soon|then)|until next time|good-?bye|bye for now|signing off)\b`,
  String.raw`\bthat'?s (?:it|all) for (?:this|today|now)\b`,
].join('|'), 'i')

/**
 * The outro never thanks listeners or signs off: code appends the kind's fixed sign-off, which
 * already does, so a model-written one makes the episode say goodbye twice (owner, 2026-10-07).
 */
function closingErrors(dialogue: PodcastDialogue): string[] {
  return dialogue.segments.flatMap((s, i) => (s.kind !== 'outro' ? [] : s.turns.flatMap((t, j) => {
    const phrase = stripTags(t.text).match(CLOSING_RE)?.[0]
    return phrase ? [`${label(s, i)}, turn ${j + 1}: says "${phrase}"; the outro must not thank listeners or sign off, because code adds the sign-off after it`] : []
  })))
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
function bandErrors(spoken: SpokenSegment[], dialogue: PodcastDialogue, kind: PodcastKind): string[] {
  const [lo, hi] = config.podcast.spokenCharBand
  const total = spoken.flatMap(s => s.turns).reduce((n, t) => n + t.text.length, 0)
  if (total >= lo && total <= hi) return []
  const own = dialogue.segments.flatMap(s => s.turns).reduce((n, t) => n + t.text.length, 0)
  const { min, max } = dialogueCharBudget(kind)
  return [`your turns total ${own} spoken characters, audio tags included; they must total ${min} to ${max}`]
}

const RELATIVE_TIME_RE = /\b(?:this|last|past|next) (?:week|month)(?:'s)?\b/i

/**
 * A standalone episode's stories may come from different weeks or months, so nothing in it dates a
 * story relative to now ("this week", "last month"). A weekly episode has no such rule.
 */
function relativeTimeErrors(dialogue: PodcastDialogue, kind: PodcastKind): string[] {
  if (kind !== 'standalone') return []
  const found = (text: string) => text.match(RELATIVE_TIME_RE)?.[0]
  const errors: string[] = []
  for (const [name, text] of [['title', dialogue.episodeTitle], ['summary', dialogue.episodeSummary]] as const) {
    const phrase = found(text)
    if (phrase) errors.push(`the episode ${name} says "${phrase}"; the stories may come from different weeks, so never date them relative to now`)
  }
  dialogue.segments.forEach((s, i) => s.turns.forEach((t, j) => {
    const phrase = found(stripTags(t.text))
    if (phrase) errors.push(`${label(s, i)}, turn ${j + 1}: says "${phrase}"; the stories may come from different weeks, so never date them relative to now`)
  }))
  return errors
}

/**
 * Every rule the dialogue must meet before it is stored; the model's errors are fed back on the one
 * regeneration. For a person's edit the style rules are warnings (`ValidationOptions`).
 */
export function validateDialogue(dialogue: PodcastDialogue, stories: DialogueStoryRef[], opts: ValidationOptions): DialogueValidation {
  const spoken = assembleSpokenSegments(dialogue, opts.kind)
  const hasUrl = urlChecker(stories)
  const style = [...segueErrors(dialogue, stories), ...closingErrors(dialogue)]
  const styleIsWarning = opts.authoredBy === 'person'
  const errors = [
    ...metadataErrors(dialogue, hasUrl),
    ...structureErrors(dialogue, stories),
    ...turnErrors(dialogue, hasUrl),
    ...relativeTimeErrors(dialogue, opts.kind),
    ...(styleIsWarning ? [] : style),
    ...speakerRunErrors(spoken),
    ...bandErrors(spoken, dialogue, opts.kind),
  ]
  return { valid: errors.length === 0, errors, warnings: styleIsWarning ? style : [] }
}

// ---------------------------------------------------------------------------
// A person's text edits
// ---------------------------------------------------------------------------

/**
 * A person's edit of the script: the stored structure, sent back with new turn text and summary.
 * Kinds, story refs and speakers are echoed, not edited, so an edit made against a script that has
 * since changed (another tab, a regeneration) is refused instead of applied to the wrong turns.
 */
export interface DialogueTextEdit {
  episodeSummary: string
  segments: { kind: string; storyRef: number | null; turns: Turn[] }[]
}

export type TurnEditResult = { dialogue: PodcastDialogue; mismatches: [] } | { dialogue: null; mismatches: string[] }

/** The structural differences between the stored dialogue and an edit; empty when only text changed. */
function structureMismatches(dialogue: PodcastDialogue, edit: DialogueTextEdit): string[] {
  if (edit.segments.length !== dialogue.segments.length) {
    return [`the script has ${dialogue.segments.length} segments, the edit ${edit.segments.length}`]
  }
  return dialogue.segments.flatMap((segment, i) => {
    const edited = edit.segments[i]
    const where = label(segment, i)
    if (edited.kind !== segment.kind || edited.storyRef !== segment.storyRef) return [`${where}: the segment's kind or story changed`]
    if (edited.turns.length !== segment.turns.length) return [`${where}: has ${segment.turns.length} turns, the edit ${edited.turns.length}`]
    return segment.turns.flatMap((turn, j) => (edited.turns[j].speaker === turn.speaker ? [] : [`${where}, turn ${j + 1}: the speaker changed`]))
  })
}

/**
 * The stored dialogue with the edit's turn text and summary, or the structural mismatches when the
 * edit changes anything but text (segments, kinds, stories, turn counts or speakers).
 */
export function applyTurnEdits(dialogue: PodcastDialogue, edit: DialogueTextEdit): TurnEditResult {
  const mismatches = structureMismatches(dialogue, edit)
  if (mismatches.length > 0) return { dialogue: null, mismatches }
  return {
    dialogue: {
      ...dialogue,
      episodeSummary: edit.episodeSummary,
      segments: dialogue.segments.map((segment, i) => ({
        ...segment,
        turns: segment.turns.map((turn, j) => ({ ...turn, text: edit.segments[i].turns[j].text })),
      })),
    },
    mismatches: [],
  }
}

/** Whether an edit changed any turn's text or the summary (a save of identical text changes nothing). */
export function textChanged(before: PodcastDialogue, after: PodcastDialogue): boolean {
  if (before.episodeSummary !== after.episodeSummary) return true
  return before.segments.some((segment, i) => segment.turns.some((turn, j) => turn.text !== after.segments[i]?.turns[j]?.text))
}

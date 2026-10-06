/**
 * A person's changes to an episode at rest: its stories (at `selected`), its script text and
 * summary (at `scripted`), its title and the "edited by a person" flag. Each change is written
 * under the episode's lease, so it cannot race a run; it ticks `humanEdited` when the stories or
 * the words changed, and rebuilds the show notes whenever their inputs change.
 */
import type { Podcast, PodcastStage } from '@prisma/client'
import { config } from '../config.js'
import type { PodcastDialogue } from '../schemas/llm.js'
import { applyTurnEdits, assembleSpokenSegments, renderScript, textChanged, validateDialogue, type DialogueTextEdit } from './podcastDialogue.js'
import { buildShowNotes, episodeSnapshots, loadEpisodePool, type EpisodeStory, type PoolEntry } from './podcastScript.js'
import { withEpisodeLease } from './podcastPipeline.js'
import { PodcastRefusedError, wasPublished } from './podcastGuards.js'

/** A person's change whose content breaks a rule (422): nothing was saved. */
export class PodcastEditRejectedError extends Error {
  constructor(readonly errors: string[], readonly warnings: string[] = []) {
    super(errors.join('; '))
    this.name = 'PodcastEditRejectedError'
  }
}

/** Refuses a legacy or published episode, and (when given) any stage but the one the change belongs to. */
function assertEditable(episode: Podcast, stage?: PodcastStage): void {
  if (episode.stage === 'legacy') throw new PodcastRefusedError('a legacy episode cannot be edited')
  if (wasPublished(episode)) throw new PodcastRefusedError('a published episode cannot be edited')
  if (stage && episode.stage !== stage) throw new PodcastRefusedError(`only an episode at ${stage} can have this changed; this one is at ${episode.stage}`)
}

export interface PoolStoryView extends PoolEntry {
  selected: boolean
}

export interface StoryPool {
  stories: PoolStoryView[]
  minStories: number
  maxStories: number
}

/** The anchor of the pool the model chose from (now, for an episode whose stories are not selected yet). */
const poolAnchor = (episode: Pick<Podcast, 'storiesSelectedAt'>): Date => episode.storiesSelectedAt ?? new Date()

/** The week's pool the model chose from, marking the episode's current stories. */
export async function getEpisodeStoryPool(episode: Pick<Podcast, 'storiesSelectedAt' | 'storyIds'>): Promise<StoryPool> {
  const chosen = new Set(episode.storyIds)
  const pool = await loadEpisodePool(poolAnchor(episode))
  return {
    stories: pool.map(s => ({ ...s, selected: chosen.has(s.id) })),
    minStories: config.podcast.minStories,
    maxStories: config.podcast.maxStories,
  }
}

function storyCountErrors(storyIds: string[]): string[] {
  const { minStories, maxStories } = config.podcast
  const errors: string[] = []
  if (new Set(storyIds).size !== storyIds.length) errors.push('a story is chosen twice')
  if (storyIds.length < minStories || storyIds.length > maxStories) {
    errors.push(`an episode has ${minStories} to ${maxStories} stories; ${storyIds.length} chosen`)
  }
  return errors
}

const sameOrder = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i])

/**
 * Replace the episode's stories (at `selected`) with pool stories, in the given order, refs 1..n.
 * Ticks "edited by a person" when the set or the order changed.
 */
export async function replaceEpisodeStories(id: string, storyIds: string[]): Promise<void> {
  const countErrors = storyCountErrors(storyIds)
  if (countErrors.length > 0) throw new PodcastEditRejectedError(countErrors)
  await withEpisodeLease(id, async ({ episode, update }) => {
    assertEditable(episode, 'selected')
    const pool = new Map((await loadEpisodePool(poolAnchor(episode))).map(s => [s.id, s]))
    const outside = storyIds.filter(storyId => !pool.has(storyId))
    if (outside.length > 0) throw new PodcastEditRejectedError([`not in this week's pool: ${outside.join(', ')}`])
    const snapshots: EpisodeStory[] = storyIds.map((storyId, i) => {
      const s = pool.get(storyId)!
      return { ref: i + 1, id: s.id, title: s.title, publisher: s.publisher, sourceUrl: s.sourceUrl, slug: s.slug, issue: s.issue }
    })
    const changed = !sameOrder(storyIds, episode.storyIds)
    await update({ episodeStories: snapshots, storyIds, humanEdited: episode.humanEdited || changed })
  }, 'edited')
}

export interface ScriptSaveResult {
  /** The segue rules a person's text breaks: shown, not blocking. */
  warnings: string[]
}

/**
 * Save a person's edit of the script's turn text and summary (at `scripted`). The structure must
 * match the stored dialogue; the merged dialogue is validated as a person's text (segue rules are
 * warnings, every other rule an error, `PodcastEditRejectedError` with nothing saved). Ticks
 * "edited by a person" when any text changed; rewrites the rendered script and the show notes.
 */
export async function saveEpisodeScript(id: string, edit: DialogueTextEdit): Promise<ScriptSaveResult> {
  return withEpisodeLease(id, async ({ episode, update }) => {
    assertEditable(episode, 'scripted')
    const stored = episode.dialogue as unknown as PodcastDialogue | null
    if (!stored) throw new PodcastRefusedError('the episode has no script to edit')
    const applied = applyTurnEdits(stored, edit)
    if (!applied.dialogue) throw new PodcastEditRejectedError(['the script changed since it was opened; reload it', ...applied.mismatches])

    const snapshots = episodeSnapshots(episode)
    const refs = snapshots.map(s => ({ ref: s.ref, title: s.title, publisher: s.publisher }))
    const validation = validateDialogue(applied.dialogue, refs, { authoredBy: 'person' })
    if (!validation.valid) throw new PodcastEditRejectedError(validation.errors, validation.warnings)

    const humanEdited = episode.humanEdited || textChanged(stored, applied.dialogue)
    await update({
      dialogue: applied.dialogue,
      episodeSummary: applied.dialogue.episodeSummary,
      script: renderScript(assembleSpokenSegments(applied.dialogue)),
      showNotes: buildShowNotes(applied.dialogue.episodeSummary, snapshots, humanEdited),
      humanEdited,
    })
    return { warnings: validation.warnings }
  }, 'edited')
}

export interface EpisodeMetaEdit {
  title?: string
  humanEdited?: boolean
}

/**
 * Change the title (once there is a script) or the "edited by a person" flag (at any stage before
 * publication). A title change never ticks the flag. The show notes follow the flag.
 */
export async function updateEpisodeMeta(id: string, edit: EpisodeMetaEdit): Promise<void> {
  await withEpisodeLease(id, async ({ episode, update }) => {
    assertEditable(episode)
    if (edit.title !== undefined && (episode.stage === 'created' || episode.stage === 'selected')) {
      throw new PodcastRefusedError('the title can be changed once the script is written')
    }
    const flagChanged = edit.humanEdited !== undefined && edit.humanEdited !== episode.humanEdited
    const notes = flagChanged && episode.showNotes !== ''
      ? { showNotes: buildShowNotes(episode.episodeSummary, episodeSnapshots(episode), edit.humanEdited!) }
      : {}
    await update({ ...(edit.title !== undefined ? { title: edit.title } : {}), ...(edit.humanEdited !== undefined ? { humanEdited: edit.humanEdited } : {}), ...notes })
  }, 'edited')
}

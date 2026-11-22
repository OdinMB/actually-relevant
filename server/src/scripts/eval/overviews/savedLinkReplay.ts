/**
 * The saved linking replay (ADR-0074; `.context/model-eval.md`, "Saved replays and free rescoring"):
 * every linking run (`link.ts`) writes its replay beside its report, so `--rescore` can score it again
 * under today's keys and scorer with no model call and no database. What it holds, its version, where
 * it lives, whether a run keeps it, and whether today's keys would replay the same stories. It holds
 * nothing that depends on the keys: the end state, the traces and the signals of each run. Plain
 * JSON: maps are stored as arrays.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { Role } from '../../../services/overviewTypes.js'
import type { FoundedOverview, StoryTrace } from './linkDiagnostics.js'
import type { StorySignal } from './linkScore.js'

/** Goes up whenever a field the scorer reads changes, so an older file is refused rather than misread. */
export const SAVED_LINK_REPLAY_VERSION = 1

/** One run's replay: what it founded (the charters, so the end events), each story's stored role, its last link attempts and its re-center signals. */
export interface SavedLinkRun {
  run: number
  overviews: FoundedOverview[]
  /** Each replayed story's stored role, by slug. */
  roles: [string, Role][]
  traces: StoryTrace[]
  signals: StorySignal[]
  /** Whether the budget stopped the run before its last story. */
  stopped: boolean
}

export interface SavedLinkReplay {
  version: number
  savedAt: string
  half: 'tune' | 'judge' | 'all'
  repeat: number
  limit?: number
  /** The slugs asked of the database, in the order asked: the half's keys' and, in a judged run, the background's (`linkReplayStories`). */
  asked: string[]
  /** Those of them not published in the database read. */
  notPublished: string[]
  /** The slugs replayed, in date order, after `--limit`. */
  replayed: string[]
  runs: SavedLinkRun[]
  /** The replay's calls given no answer because none was made, and those that came back `error`. */
  unanswered: number
  errored: number
  /** The recorded cost of every call the replay asked, cached ones included: what the replay costs as made. */
  costUsd: number
}

/** The file beside the report: tagged by the report's half, repeat and limit only, since one replay serves the three linking steps. */
export function savedReplayName({ half, repeat, limit }: { half: SavedLinkReplay['half']; repeat: number; limit?: number }): string {
  const tags = [...(half === 'all' ? [] : [`half-${half}`]), ...(repeat > 1 ? [`repeat-${repeat}`] : []), ...(limit !== undefined ? [`limit-${limit}`] : [])]
  return `linking-replay${tags.map(t => `-${t}`).join('')}.json`
}

/**
 * Why a run's replay is not saved, or null where it is: it is saved from every run but a cache-only
 * rerun that is not the run it reruns, because it left a call unanswered (it drifted) or a run of it
 * stopped before its last story. Saving that rerun would replace a real outcome with a lesser one;
 * one with every call answered and every run carried through is made of recorded answers only.
 */
export function replayNotSaved(replay: Pick<SavedLinkReplay, 'unanswered' | 'runs'>, run: { cacheOnly: boolean }): string | null {
  if (!run.cacheOnly) return null
  if (replay.unanswered > 0) return `${replay.unanswered} calls were not in the cache, so this rerun drifted from the run it reruns`
  const stopped = replay.runs.filter(r => r.stopped).map(r => r.run)
  if (stopped.length > 0)
    return `run${stopped.length === 1 ? '' : 's'} ${stopped.join(', ')} stopped before the last story, so this rerun is not the run it reruns`
  return null
}

export function writeSavedReplay(file: string, replay: SavedLinkReplay): void {
  writeFileSync(file, JSON.stringify(replay, null, 1))
}

/** The saved replay, or why it cannot be scored and what to run instead. */
export function readSavedReplay(file: string): { replay: SavedLinkReplay } | { refused: string } {
  const remake =
    'run the linking steps without --rescore first (for a run made at --concurrency 1, rebuild its replay for free with --concurrency 1 --cache-only)'
  if (!existsSync(file)) return { refused: `no saved replay at ${file}: ${remake}` }
  const replay = JSON.parse(readFileSync(file, 'utf8')) as Partial<SavedLinkReplay>
  if (replay.version !== SAVED_LINK_REPLAY_VERSION) {
    return { refused: `the saved replay at ${file} is version ${String(replay.version)}, and this code reads version ${SAVED_LINK_REPLAY_VERSION}: ${remake}` }
  }
  return { replay: replay as SavedLinkReplay }
}

/** The slugs today's keys ask for that the saved run did not (`added`), and those it asked that they no longer name (`removed`). */
export function replayDrift(saved: Pick<SavedLinkReplay, 'asked'>, asked: readonly string[]): { added: string[]; removed: string[] } {
  const before = new Set(saved.asked)
  const now = new Set(asked)
  return { added: asked.filter(s => !before.has(s)), removed: saved.asked.filter(s => !now.has(s)) }
}

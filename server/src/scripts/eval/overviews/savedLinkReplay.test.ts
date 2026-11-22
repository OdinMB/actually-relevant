import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  keepsSavedReplay,
  readSavedReplay,
  replayDrift,
  SAVED_LINK_REPLAY_VERSION,
  savedReplayName,
  writeSavedReplay,
  type SavedLinkReplay,
} from './savedLinkReplay.js'

const saved: SavedLinkReplay = {
  version: SAVED_LINK_REPLAY_VERSION,
  savedAt: '2026-11-22T10:00:00.000Z',
  half: 'judge',
  repeat: 3,
  asked: ['a', 'b', 'c', 'gone'],
  notPublished: ['gone'],
  replayed: ['a', 'b', 'c'],
  runs: [{ run: 1, overviews: [], roles: [['a', { role: 'routine', roleKind: null }]], traces: [], signals: [], stopped: false }],
  unanswered: 0,
  errored: 0,
  costUsd: 0.31,
}

describe('the saved linking replay', () => {
  const dirs: string[] = []
  const temp = () => {
    const dir = mkdtempSync(join(tmpdir(), 'saved-replay-'))
    dirs.push(dir)
    return dir
  }
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  it('reads back what was written', () => {
    const file = join(temp(), savedReplayName(saved))
    writeSavedReplay(file, saved)
    expect(readSavedReplay(file)).toEqual({ replay: saved })
  })

  it('refuses a missing file and a file of another version, each saying what to run instead', () => {
    const dir = temp()
    const missing = readSavedReplay(join(dir, 'linking-replay.json'))
    expect(missing).toMatchObject({ refused: expect.stringMatching(/without --rescore/) })
    const older = join(dir, 'linking-replay-half-judge.json')
    writeFileSync(older, JSON.stringify({ ...saved, version: SAVED_LINK_REPLAY_VERSION - 1 }))
    const refused = readSavedReplay(older)
    expect(refused).toMatchObject({ refused: expect.stringMatching(/without --rescore/) })
    expect(refused).not.toEqual(missing)
  })

  it("names the file by the report's half, repeat and limit only, as one replay serves the three linking steps", () => {
    expect(savedReplayName({ half: 'all', repeat: 1 })).toBe('linking-replay.json')
    expect(savedReplayName({ half: 'judge', repeat: 3, limit: 20 })).toBe('linking-replay-half-judge-repeat-3-limit-20.json')
  })

  it("gives the slugs today's keys ask for that the run did not, and those it asked that they no longer name", () => {
    expect(replayDrift(saved, ['a', 'b', 'c', 'gone'])).toEqual({ added: [], removed: [] })
    expect(replayDrift(saved, ['b', 'a', 'd', 'gone'])).toEqual({ added: ['d'], removed: ['c'] })
  })

  it('is kept from every run but a cache-only rerun that left a call unanswered, which drifted from the run it reruns', () => {
    expect(keepsSavedReplay(saved, { cacheOnly: false })).toBe(true)
    expect(keepsSavedReplay({ ...saved, unanswered: 4 }, { cacheOnly: false })).toBe(true)
    expect(keepsSavedReplay(saved, { cacheOnly: true })).toBe(true)
    expect(keepsSavedReplay({ ...saved, unanswered: 4 }, { cacheOnly: true })).toBe(false)
  })
})

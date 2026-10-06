import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import { existsSync, writeFileSync } from 'fs'
import path from 'path'

const mockSpawn = vi.hoisted(() => vi.fn())
vi.mock('child_process', () => ({ spawn: mockSpawn }))

const { assembleEpisodeMp3, buildAssembleArgs, cbrDurationMs, AI_PROVENANCE_FRAMES } = await import('./podcastAudio.js')

const tags = { title: 'Week 41', artist: 'Actually Relevant', album: 'Actually Relevant', comment: 'AI-generated.' }

/** A fake ffmpeg: writes `outputBytes` to the output file (the last argument) and exits with `code`. */
function fakeFfmpeg(code: number, outputBytes = 0) {
  mockSpawn.mockImplementation((_bin: string, args: string[]) => {
    const child = Object.assign(new EventEmitter(), { stderr: new EventEmitter(), kill: vi.fn() })
    setImmediate(() => {
      if (code === 0) writeFileSync(args[args.length - 1], Buffer.alloc(outputBytes))
      else child.stderr.emit('data', Buffer.from('Invalid data found'))
      child.emit('close', code)
    })
    return child
  })
}

const live = { pauseMs: 700, loudnorm: true }
const filterOf =(args: string[]) => args[args.indexOf('-filter_complex') + 1]

describe('buildAssembleArgs', () => {
  it('pads every chunk but the last with the pause, then joins and loudnorms', () => {
    const args = buildAssembleArgs(['a.mp3', 'b.mp3', 'c.mp3'], tags, live, 'out.mp3')
    const parts = filterOf(args).split(';')
    expect(parts[0]).toContain('apad=pad_dur=700ms')
    expect(parts[1]).toContain('apad=pad_dur=700ms')
    expect(parts[2]).not.toContain('apad')
    expect(parts[3]).toMatch(/^\[a0\]\[a1\]\[a2\]concat=n=3:v=0:a=1,loudnorm=I=-16:/)
    expect(args.filter(a => a === '-i')).toHaveLength(3)
    expect(args.at(-1)).toBe('out.mp3')
  })

  it('adds no pause to a single chunk or with a zero pause', () => {
    expect(filterOf(buildAssembleArgs(['a.mp3'], tags, live, 'o.mp3'))).not.toContain('apad')
    expect(filterOf(buildAssembleArgs(['a.mp3', 'b.mp3'], tags, { ...live, pauseMs: 0 }, 'o.mp3'))).not.toContain('apad')
  })

  it('leaves loudnorm out when asked (the silent dry-run stub)', () => {
    expect(filterOf(buildAssembleArgs(['a.mp3', 'b.mp3'], tags, { ...live, loudnorm: false }, 'o.mp3'))).not.toContain('loudnorm')
  })

  it('writes the episode tags and the AI-provenance frames, dropping the chunks\' own metadata', () => {
    const args = buildAssembleArgs(['a.mp3'], tags, live, 'o.mp3')
    const metadata = args.flatMap((a, i) => (a === '-metadata' ? [args[i + 1]] : []))
    expect(metadata).toEqual(expect.arrayContaining([
      'title=Week 41', 'artist=Actually Relevant', 'album=Actually Relevant', 'comment=AI-generated.',
      ...Object.entries(AI_PROVENANCE_FRAMES).map(([k, v]) => `${k}=${v}`),
    ]))
    expect(args.join(' ')).toContain('-map_metadata -1')
    expect(args.join(' ')).toContain('-c:a libmp3lame -b:a 128k')
  })
})

describe('assembleEpisodeMp3', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the output and its duration from the byte length', async () => {
    fakeFfmpeg(0, 16_000 * 300) // 300 s at 128 kbps
    const { buffer, durationSec } = await assembleEpisodeMp3([Buffer.from('a'), Buffer.from('b')], tags, live)
    expect(buffer.length).toBe(16_000 * 300)
    expect(durationSec).toBe(300)
  })

  it('removes its temp files when ffmpeg fails', async () => {
    fakeFfmpeg(1)
    await expect(assembleEpisodeMp3([Buffer.from('a')], tags, live)).rejects.toThrow(/ffmpeg exited with 1: Invalid data found/)
    const args: string[] = mockSpawn.mock.calls[0][1]
    const input = args[args.indexOf('-i') + 1]
    expect(existsSync(path.dirname(input))).toBe(false)
  })

  it('refuses an empty chunk list', async () => {
    await expect(assembleEpisodeMp3([], tags, live)).rejects.toThrow('no audio chunks')
    expect(mockSpawn).not.toHaveBeenCalled()
  })
})

describe('cbrDurationMs', () => {
  it('derives milliseconds from bytes at 128 kbps', () => {
    expect(cbrDurationMs(16_000)).toBe(1000)
  })
})

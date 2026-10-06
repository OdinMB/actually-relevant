/**
 * Runs the real ffmpeg-static binary on generated one-second chunks and reads the ID3 frames back.
 * Skipped where the binary is absent.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import os from 'os'
import path from 'path'
import { assembleEpisodeMp3, ffmpegStaticPath, silentMp3, IPTC_TRAINED_ALGORITHMIC_MEDIA } from './podcastAudio.js'

const binary = ffmpegStaticPath && existsSync(ffmpegStaticPath) ? ffmpegStaticPath : null
const tags = { title: 'Test episode', artist: 'Actually Relevant', album: 'Actually Relevant', comment: 'AI-generated test.' }

describe.skipIf(!binary)('podcastAudio with the real ffmpeg', () => {
  let dir = ''
  beforeAll(() => { dir = mkdtempSync(path.join(os.tmpdir(), 'podcast-audio-test-')) })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  function readTags(buffer: Buffer): string {
    const file = path.join(dir, `probe-${Date.now()}.mp3`)
    writeFileSync(file, buffer)
    return spawnSync(binary!, ['-hide_banner', '-i', file, '-f', 'ffmetadata', '-'], { encoding: 'utf8' }).stdout
  }

  /** A one-second tone, like a voiced chunk: something loudnorm can measure. */
  function toneChunk(): Buffer {
    const file = path.join(dir, 'tone.mp3')
    spawnSync(binary!, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=1', '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '128k', file])
    return readFileSync(file)
  }

  it('joins voiced chunks with the pause, loudnorms them and writes the AI-provenance ID3 frames', async () => {
    const tone = toneChunk()
    const { buffer, durationSec } = await assembleEpisodeMp3([tone, tone], tags, { pauseMs: 700, loudnorm: true })

    // 1 s + 0.7 s + 1 s; the CBR estimate allows about a second for the tag frames and encoder padding.
    expect(Math.abs(durationSec - 2.7)).toBeLessThanOrEqual(1)
    const metadata = readTags(buffer)
    expect(metadata).toContain('title=Test episode')
    expect(metadata).toContain('AI-generated=true')
    expect(metadata).toContain(`digitalSourceType=${IPTC_TRAINED_ALGORITHMIC_MEDIA}`)
  }, 60_000)

  it('assembles the silent dry-run stub without loudnorm', async () => {
    const chunk = await silentMp3(1)
    const { durationSec } = await assembleEpisodeMp3([chunk, chunk], tags, { pauseMs: 700, loudnorm: false })
    expect(Math.abs(durationSec - 2.7)).toBeLessThanOrEqual(1)
  }, 60_000)
})

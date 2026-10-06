/**
 * Producing podcast MP3 files with the pinned `ffmpeg-static` binary (ADR-0005): joining the voiced
 * chunks with a pause between them, loudness-normalising, re-encoding to CBR mono and writing the
 * ID3 tags with the AI-provenance frames, and generating silence for the dry-run stub voice. Works
 * on temp files in `os.tmpdir()` and always removes them.
 */
import { spawn } from 'child_process'
import fs from 'fs/promises'
import { existsSync } from 'fs'
import { createRequire } from 'module'
import os from 'os'
import path from 'path'
import { config } from '../config.js'

/**
 * The binary's path. `ffmpeg-static` is CommonJS and exports the path string itself, which its
 * types describe as a default export; requiring it reads the value its types cannot.
 */
export const ffmpegStaticPath = createRequire(import.meta.url)('ffmpeg-static') as string | null

/** IPTC digital source type for media created by a trained model (no standard ID3 frame exists for it). */
export const IPTC_TRAINED_ALGORITHMIC_MEDIA = 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia'

/**
 * Machine-readable AI marks written as ID3v2 TXXX frames (ffmpeg writes a metadata key with no
 * standard frame as TXXX with the key as its description).
 */
export const AI_PROVENANCE_FRAMES: Readonly<Record<string, string>> = {
  'AI-generated': 'true',
  digitalSourceType: IPTC_TRAINED_ALGORITHMIC_MEDIA,
}

export interface EpisodeTags {
  title: string
  artist: string
  album: string
  comment: string
}

const FFMPEG_TIMEOUT_MS = 5 * 60_000

/** Duration of a constant-bitrate MP3 from its size (no ffprobe needed). */
export function cbrDurationMs(bytes: number, kbps: number = config.podcast.audioBitrateKbps): number {
  return Math.round((bytes * 8) / kbps)
}

function ffmpegBinary(): string {
  if (!ffmpegStaticPath || !existsSync(ffmpegStaticPath)) throw new Error('ffmpeg binary not found (ffmpeg-static did not install it)')
  return ffmpegStaticPath
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBinary(), ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr?.on('data', (d: Buffer) => { stderr = (stderr + d.toString()).slice(-2000) })
    const timer = setTimeout(() => child.kill('SIGKILL'), FFMPEG_TIMEOUT_MS)
    child.on('error', err => { clearTimeout(timer); reject(err) })
    child.on('close', code => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exited with ${code}: ${stderr.trim()}`))
    })
  })
}

async function withTempDir<T>(work: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'podcast-audio-'))
  try {
    return await work(dir)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

const encodeArgs = () => ['-ar', '44100', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', `${config.podcast.audioBitrateKbps}k`]

function metadataArgs(tags: EpisodeTags): string[] {
  const entries: [string, string][] = [
    ['title', tags.title],
    ['artist', tags.artist],
    ['album', tags.album],
    ['comment', tags.comment],
    ...Object.entries(AI_PROVENANCE_FRAMES),
  ]
  return ['-map_metadata', '-1', '-id3v2_version', '3', '-write_id3v1', '0', ...entries.flatMap(([k, v]) => ['-metadata', `${k}=${v}`])]
}

export interface AssembleOptions {
  /** Silence inserted after every chunk but the last. */
  pauseMs: number
  /**
   * Loudness-normalise the joined episode. Off for the dry-run stub: loudnorm on pure digital
   * silence produces invalid samples that crash the MP3 encoder.
   */
  loudnorm: boolean
}

/**
 * The ffmpeg arguments that join the chunks in order with `pauseMs` of silence after every chunk but
 * the last, loudness-normalise the whole (when asked), and encode with the tags.
 */
export function buildAssembleArgs(inputs: string[], tags: EpisodeTags, opts: AssembleOptions, output: string): string[] {
  const pad = `apad=pad_dur=${opts.pauseMs}ms`
  const prepared = inputs.map((_, i) => `[${i}:a]aformat=sample_rates=44100:channel_layouts=mono${i < inputs.length - 1 && opts.pauseMs > 0 ? `,${pad}` : ''}[a${i}]`)
  const normalise = opts.loudnorm ? `,loudnorm=I=${config.podcast.loudnessLufs}:TP=-1.5:LRA=11` : ''
  const joined = `${inputs.map((_, i) => `[a${i}]`).join('')}concat=n=${inputs.length}:v=0:a=1${normalise}[out]`
  return [
    ...inputs.flatMap(f => ['-i', f]),
    '-filter_complex', [...prepared, joined].join(';'),
    '-map', '[out]',
    ...encodeArgs(),
    ...metadataArgs(tags),
    output,
  ]
}

/** One episode MP3 from the voiced chunks, in order. */
export async function assembleEpisodeMp3(chunks: Buffer[], tags: EpisodeTags, opts: AssembleOptions): Promise<{ buffer: Buffer; durationSec: number }> {
  if (chunks.length === 0) throw new Error('no audio chunks to assemble')
  return withTempDir(async dir => {
    const inputs = await Promise.all(chunks.map(async (bytes, i) => {
      const file = path.join(dir, `chunk-${String(i).padStart(3, '0')}.mp3`)
      await fs.writeFile(file, bytes)
      return file
    }))
    const output = path.join(dir, 'episode.mp3')
    await runFfmpeg(buildAssembleArgs(inputs, tags, opts, output))
    const buffer = await fs.readFile(output)
    return { buffer, durationSec: Math.round(cbrDurationMs(buffer.length) / 1000) }
  })
}

/** Silence of the given length as a CBR MP3: the dry-run stub voice. */
export async function silentMp3(seconds: number): Promise<Buffer> {
  return withTempDir(async dir => {
    const output = path.join(dir, 'silence.mp3')
    await runFfmpeg(['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', String(Math.max(0.1, seconds)), ...encodeArgs(), output])
    return fs.readFile(output)
  })
}

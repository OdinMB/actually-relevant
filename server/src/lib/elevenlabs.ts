/**
 * The ElevenLabs HTTP contract: Text to Dialogue (model pinned in config) and the subscription
 * balance. A thin axios client instead of the SDK, whose own retries would double-bill. Credit,
 * auth and other 4xx refusals are never retried; a timed-out call is not retried either, because
 * ElevenLabs may have billed it. Only 429 and 5xx answers, which carry no audio, are retried once.
 */
import axios, { type AxiosResponse } from 'axios'
import { config } from '../config.js'
import { withRetry } from './retry.js'

export interface DialogueInput {
  text: string
  voiceId: string
}

export interface DialogueRequest {
  inputs: DialogueInput[]
  /** The render's seed: one seed for every chunk of a render, a fresh one per "Regenerate audio". */
  seed: number
  /** Text spoken just before this request (continuity), at most `continuityChars`. */
  previousText?: string
  /** Text spoken just after this request (continuity), at most `continuityChars`. */
  futureText?: string
}

export interface DialogueAudio {
  audio: Buffer
  requestId: string | null
  /** Characters sent in `inputs` (what the spend ledger reserves). */
  chars: number
  /** The `character-cost` response header: what ElevenLabs says it billed for this call. */
  characterCost: number | null
}

/** ElevenLabs refused for credits, quota, auth or a paused account: retrying will not help. */
export class ElevenLabsQuotaError extends Error {
  constructor(message: string, readonly status: number | undefined) {
    super(message)
    this.name = 'ElevenLabsQuotaError'
  }
}

export function isElevenLabsConfigured(): boolean {
  return config.elevenlabs.apiKey !== ''
}

const REFUSAL_STATUS = /quota|credit|payment|paused|suspended|unusual_activity|invalid_api_key|missing_permissions/i

/** The response body as text, whether axios read it as an ArrayBuffer, a string or JSON. */
function bodyText(data: unknown): string {
  if (data == null) return ''
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8')
  return typeof data === 'string' ? data : JSON.stringify(data)
}

/** Credits, auth and account refusals become `ElevenLabsQuotaError`; everything else passes through. */
function classify(err: unknown): unknown {
  if (!axios.isAxiosError(err) || !err.response) return err
  const status = err.response.status
  const body = bodyText(err.response.data).slice(0, 500)
  if (status === 401 || status === 402 || status === 403 || (status === 429 && REFUSAL_STATUS.test(body))) {
    return new ElevenLabsQuotaError(`ElevenLabs refused (HTTP ${status}): ${body}`, status)
  }
  return err
}

/** Retry only answers that carry no audio and no bill: 429 (not a quota refusal) and 5xx. */
function retryableAnswer(err: unknown): boolean {
  if (err instanceof ElevenLabsQuotaError) return false
  const status = axios.isAxiosError(err) ? err.response?.status : undefined
  return status === 429 || (status !== undefined && status >= 500)
}

async function call<T>(request: () => Promise<AxiosResponse<T>>): Promise<AxiosResponse<T>> {
  return withRetry(async () => {
    try {
      return await request()
    } catch (err) {
      throw classify(err)
    }
  }, { retries: 1, retryOn: retryableAnswer })
}

function headers(accept: string): Record<string, string> {
  return { 'xi-api-key': config.elevenlabs.apiKey, 'Content-Type': 'application/json', Accept: accept }
}

/** Voice one chunk of dialogue: POST /v1/text-to-dialogue with the pinned model and the given seed. */
export async function textToDialogue(req: DialogueRequest): Promise<DialogueAudio> {
  const body = {
    model_id: config.podcast.ttsModelId,
    seed: req.seed,
    language_code: 'en',
    inputs: req.inputs.map(i => ({ text: i.text, voice_id: i.voiceId })),
    ...(req.previousText ? { previous_text: req.previousText } : {}),
    ...(req.futureText ? { future_text: req.futureText } : {}),
  }
  const res = await call(() => axios.post<ArrayBuffer>(
    `${config.elevenlabs.baseUrl}/v1/text-to-dialogue?output_format=${config.podcast.ttsOutputFormat}`,
    body,
    {
      headers: headers('audio/mpeg'),
      responseType: 'arraybuffer',
      timeout: config.elevenlabs.timeoutMs,
      maxContentLength: config.elevenlabs.maxResponseBytes,
    },
  ))
  const cost = res.headers['character-cost']
  const requestId = res.headers['request-id']
  return {
    audio: Buffer.from(res.data),
    requestId: typeof requestId === 'string' && requestId !== '' ? requestId : null,
    chars: req.inputs.reduce((n, i) => n + i.text.length, 0),
    characterCost: cost != null && Number.isFinite(Number(cost)) ? Number(cost) : null,
  }
}

interface Subscription {
  character_count: number
  character_limit: number
}

/** Credits left on the subscription: GET /v1/user/subscription (lags a few calls behind usage). */
export async function getRemainingCharacters(): Promise<number> {
  const res = await call(() => axios.get<Subscription>(`${config.elevenlabs.baseUrl}/v1/user/subscription`, {
    headers: headers('application/json'),
    timeout: 30_000,
  }))
  return res.data.character_limit - res.data.character_count
}

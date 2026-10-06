import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios'

const mockAxios = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }))

vi.mock('axios', async importOriginal => {
  const actual = await importOriginal<typeof import('axios')>()
  return { ...actual, default: { ...actual.default, post: mockAxios.post, get: mockAxios.get, isAxiosError: actual.isAxiosError } }
})
vi.mock('../config.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../config.js')>()
  return { ...actual, config: { ...actual.config, elevenlabs: { ...actual.config.elevenlabs, apiKey: 'test-key' } } }
})
// No backoff waits in tests.
vi.mock('./retry.js', async importOriginal => {
  const actual = await importOriginal<typeof import('./retry.js')>()
  return { ...actual, withRetry: <T>(fn: () => Promise<T>, opts: Parameters<typeof actual.withRetry>[1]) => actual.withRetry(fn, { ...opts, baseDelayMs: 0 }) }
})

const { textToDialogue, getRemainingCharacters, ElevenLabsQuotaError } = await import('./elevenlabs.js')
const { config } = await import('../config.js')

function audioResponse(headers: Record<string, string> = {}): AxiosResponse<ArrayBuffer> {
  const bytes = Buffer.from('ID3fake-mp3')
  return { data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), status: 200, statusText: 'OK', headers, config: { headers: new AxiosHeaders() } }
}

function httpError(status: number, body: unknown): AxiosError {
  const data = Buffer.from(JSON.stringify(body))
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_RESPONSE', undefined, undefined, {
    data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), status, statusText: '', headers: {}, config: { headers: new AxiosHeaders() },
  })
}

const inputs = [{ text: 'Hello there.', voiceId: 'voice-a' }, { text: 'Hi.', voiceId: 'voice-b' }]

describe('textToDialogue', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sends the pinned model, seed and voices, with continuity only where given', async () => {
    mockAxios.post.mockResolvedValueOnce(audioResponse())
    await textToDialogue({ inputs, futureText: 'Next up.' })

    const [url, body, opts] = mockAxios.post.mock.calls[0]
    expect(url).toBe(`${config.elevenlabs.baseUrl}/v1/text-to-dialogue?output_format=${config.podcast.ttsOutputFormat}`)
    expect(body).toEqual({
      model_id: config.podcast.ttsModelId,
      seed: config.podcast.ttsSeed,
      language_code: 'en',
      inputs: [{ text: 'Hello there.', voice_id: 'voice-a' }, { text: 'Hi.', voice_id: 'voice-b' }],
      future_text: 'Next up.',
    })
    expect(body).not.toHaveProperty('previous_text')
    expect(opts.headers['xi-api-key']).toBe('test-key')
    expect(opts.responseType).toBe('arraybuffer')
  })

  it('reads the request id and the billed character cost from the headers', async () => {
    mockAxios.post.mockResolvedValueOnce(audioResponse({ 'request-id': 'req-1', 'character-cost': '42' }))
    const result = await textToDialogue({ inputs })
    expect(result).toMatchObject({ requestId: 'req-1', characterCost: 42, chars: 15 })
    expect(result.audio.toString()).toBe('ID3fake-mp3')
  })

  it('reports no cost when the header is missing', async () => {
    mockAxios.post.mockResolvedValueOnce(audioResponse())
    expect((await textToDialogue({ inputs })).characterCost).toBeNull()
  })

  it.each([
    [401, { detail: { status: 'invalid_api_key' } }],
    [402, { detail: { status: 'payment_required' } }],
    [429, { detail: { status: 'quota_exceeded' } }],
  ])('turns HTTP %i into ElevenLabsQuotaError without retrying', async (status, body) => {
    mockAxios.post.mockRejectedValueOnce(httpError(status, body))
    await expect(textToDialogue({ inputs })).rejects.toBeInstanceOf(ElevenLabsQuotaError)
    expect(mockAxios.post).toHaveBeenCalledTimes(1)
  })

  it('does not retry another 4xx', async () => {
    mockAxios.post.mockRejectedValueOnce(httpError(422, { detail: 'bad input' }))
    await expect(textToDialogue({ inputs })).rejects.toThrow('422')
    expect(mockAxios.post).toHaveBeenCalledTimes(1)
  })

  it('does not retry a timeout, which may have been billed', async () => {
    mockAxios.post.mockRejectedValueOnce(new AxiosError('timeout of 120000ms exceeded', 'ECONNABORTED'))
    await expect(textToDialogue({ inputs })).rejects.toThrow('timeout')
    expect(mockAxios.post).toHaveBeenCalledTimes(1)
  })

  it('retries a 5xx once', async () => {
    mockAxios.post.mockRejectedValueOnce(httpError(503, { detail: 'busy' })).mockResolvedValueOnce(audioResponse())
    await textToDialogue({ inputs })
    expect(mockAxios.post).toHaveBeenCalledTimes(2)
  })

  it('gives up after the one retry', async () => {
    mockAxios.post.mockRejectedValue(httpError(500, {}))
    await expect(textToDialogue({ inputs })).rejects.toThrow('500')
    expect(mockAxios.post).toHaveBeenCalledTimes(2)
  })
})

describe('getRemainingCharacters', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the limit minus the count', async () => {
    mockAxios.get.mockResolvedValueOnce({ data: { character_count: 1200, character_limit: 30000 } })
    expect(await getRemainingCharacters()).toBe(28800)
    expect(mockAxios.get.mock.calls[0][0]).toBe(`${config.elevenlabs.baseUrl}/v1/user/subscription`)
  })
})

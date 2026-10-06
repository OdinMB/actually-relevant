import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHash } from 'crypto'
import { AxiosError, AxiosHeaders } from 'axios'

const mockAxios = vi.hoisted(() => ({ put: vi.fn(), delete: vi.fn() }))

vi.mock('axios', async importOriginal => {
  const actual = await importOriginal<typeof import('axios')>()
  return { ...actual, default: { ...actual.default, put: mockAxios.put, delete: mockAxios.delete, isAxiosError: actual.isAxiosError } }
})
vi.mock('../config.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../config.js')>()
  return { ...actual, config: { ...actual.config, bunny: { ...actual.config.bunny, storageZone: 'ar-audio', storagePassword: 'zone-pass' } } }
})

const { putObject, deleteObject, publicUrl, isBunnyConfigured } = await import('./bunnyStorage.js')
const { config } = await import('../config.js')

function httpError(status: number): AxiosError {
  return new AxiosError(`status ${status}`, 'ERR', undefined, undefined, { data: '', status, statusText: '', headers: {}, config: { headers: new AxiosHeaders() } })
}

describe('bunnyStorage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uploads to the zone with the access key, content type and SHA-256 checksum', async () => {
    mockAxios.put.mockResolvedValueOnce({ status: 201 })
    const body = Buffer.from('mp3 bytes')
    await putObject('episodes/2026-W41-abcd1234.mp3', body, 'audio/mpeg')

    const [url, sent, opts] = mockAxios.put.mock.calls[0]
    expect(url).toBe(`https://${config.bunny.storageHost}/ar-audio/episodes/2026-W41-abcd1234.mp3`)
    expect(sent).toBe(body)
    expect(opts.headers).toEqual({
      AccessKey: 'zone-pass',
      'Content-Type': 'audio/mpeg',
      Checksum: createHash('sha256').update(body).digest('hex').toUpperCase(),
    })
  })

  it('refuses a path that could escape the zone or needs encoding', async () => {
    await expect(putObject('../secret.mp3', Buffer.from(''), 'audio/mpeg')).rejects.toThrow('invalid storage path')
    await expect(putObject('/episodes/a.mp3', Buffer.from(''), 'audio/mpeg')).rejects.toThrow('invalid storage path')
    await expect(putObject('episodes/ä.mp3', Buffer.from(''), 'audio/mpeg')).rejects.toThrow('invalid storage path')
    expect(mockAxios.put).not.toHaveBeenCalled()
  })

  it('deletes an object and treats a missing one as deleted', async () => {
    mockAxios.delete.mockRejectedValueOnce(httpError(404))
    await expect(deleteObject('episodes/x.vtt')).resolves.toBeUndefined()
    expect(mockAxios.delete.mock.calls[0][1].headers).toEqual({ AccessKey: 'zone-pass' })
  })

  it('surfaces a refused delete', async () => {
    mockAxios.delete.mockRejectedValueOnce(httpError(401))
    await expect(deleteObject('episodes/x.vtt')).rejects.toThrow('401')
  })

  it('builds the public CDN URL from the audio base URL', () => {
    expect(publicUrl('dry-run/episodes/a.mp3')).toBe(`${config.podcast.audioBaseUrl}/dry-run/episodes/a.mp3`)
  })

  it('is configured when both the zone and its password are set', () => {
    expect(isBunnyConfigured()).toBe(true)
  })
})

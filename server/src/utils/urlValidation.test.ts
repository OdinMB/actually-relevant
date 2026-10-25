import { describe, it, expect, vi } from 'vitest'
import { assertRedirectAllowed, BlockedUrlError, isAllowedUrl, isPrivateAddress, safeLookup } from './urlValidation.js'

const mockDnsLookup = vi.hoisted(() => vi.fn())
vi.mock('dns', async importOriginal => ({ ...(await importOriginal<typeof import('dns')>()), lookup: mockDnsLookup }))

describe('isAllowedUrl', () => {
  it('allows standard HTTPS URLs', () => {
    expect(isAllowedUrl('https://example.com/article')).toBe(true)
    expect(isAllowedUrl('https://news.ycombinator.com/item?id=123')).toBe(true)
    expect(isAllowedUrl('https://www.bbc.co.uk/news/article')).toBe(true)
  })

  it('allows standard HTTP URLs', () => {
    expect(isAllowedUrl('http://example.com/article')).toBe(true)
  })

  it('blocks non-HTTP protocols', () => {
    expect(isAllowedUrl('ftp://example.com/file')).toBe(false)
    expect(isAllowedUrl('file:///etc/passwd')).toBe(false)
    expect(isAllowedUrl('javascript:alert(1)')).toBe(false)
  })

  it('blocks localhost', () => {
    expect(isAllowedUrl('http://localhost/admin')).toBe(false)
    expect(isAllowedUrl('http://localhost:3000/api')).toBe(false)
    expect(isAllowedUrl('http://LOCALHOST/admin')).toBe(false)
  })

  it('blocks loopback addresses', () => {
    expect(isAllowedUrl('http://127.0.0.1/admin')).toBe(false)
    expect(isAllowedUrl('http://127.0.0.1:8080/api')).toBe(false)
    expect(isAllowedUrl('http://[::1]/admin')).toBe(false)
  })

  it('blocks private network ranges (10.x.x.x)', () => {
    expect(isAllowedUrl('http://10.0.0.1/internal')).toBe(false)
    expect(isAllowedUrl('http://10.255.255.255/internal')).toBe(false)
  })

  it('blocks private network ranges (172.16-31.x.x)', () => {
    expect(isAllowedUrl('http://172.16.0.1/internal')).toBe(false)
    expect(isAllowedUrl('http://172.31.255.255/internal')).toBe(false)
  })

  it('blocks private network ranges (192.168.x.x)', () => {
    expect(isAllowedUrl('http://192.168.0.1/internal')).toBe(false)
    expect(isAllowedUrl('http://192.168.1.100/internal')).toBe(false)
  })

  it('blocks link-local / cloud metadata (169.254.x.x)', () => {
    expect(isAllowedUrl('http://169.254.169.254/latest/meta-data')).toBe(false)
    expect(isAllowedUrl('http://169.254.0.1/metadata')).toBe(false)
  })

  it('blocks 0.0.0.0', () => {
    expect(isAllowedUrl('http://0.0.0.0/')).toBe(false)
  })

  it('blocks IPv6 private addresses', () => {
    expect(isAllowedUrl('http://[fc00::1]/')).toBe(false)
    expect(isAllowedUrl('http://[fe80::1]/')).toBe(false)
  })

  it('blocks .internal and .local domains', () => {
    expect(isAllowedUrl('http://service.internal/api')).toBe(false)
    expect(isAllowedUrl('http://printer.local/status')).toBe(false)
  })

  it('returns false for invalid URLs', () => {
    expect(isAllowedUrl('not-a-url')).toBe(false)
    expect(isAllowedUrl('')).toBe(false)
  })

  it('blocks single-label hostnames (private service names)', () => {
    expect(isAllowedUrl('http://actually-relevant-db:5432/')).toBe(false)
    expect(isAllowedUrl('http://redis/')).toBe(false)
    expect(isAllowedUrl('http://example.com./')).toBe(true)
  })

  it('blocks localhost subdomains and other internal zones', () => {
    expect(isAllowedUrl('http://api.localhost/')).toBe(false)
    expect(isAllowedUrl('http://nas.home.arpa/')).toBe(false)
    expect(isAllowedUrl('http://box.localdomain/')).toBe(false)
  })

  it('blocks IPv4-mapped and other IPv6 spellings of private addresses', () => {
    expect(isAllowedUrl('http://[::ffff:127.0.0.1]/')).toBe(false)
    expect(isAllowedUrl('http://[::ffff:7f00:1]/')).toBe(false)
    expect(isAllowedUrl('http://[::ffff:a9fe:a9fe]/')).toBe(false) // 169.254.169.254
    expect(isAllowedUrl('http://[64:ff9b::a00:1]/')).toBe(false) // NAT64 of 10.0.0.1
    expect(isAllowedUrl('http://[fd12:3456::1]/')).toBe(false)
    expect(isAllowedUrl('http://[::]/')).toBe(false)
  })

  it('blocks numeric and hex IPv4 spellings the URL parser normalizes', () => {
    expect(isAllowedUrl('http://2130706433/')).toBe(false) // 127.0.0.1
    expect(isAllowedUrl('http://0x7f.1/')).toBe(false)
    expect(isAllowedUrl('http://100.64.0.1/')).toBe(false) // carrier-grade NAT
  })

  it('allows public IP literals, including mapped ones', () => {
    expect(isAllowedUrl('http://8.8.8.8/')).toBe(true)
    expect(isAllowedUrl('http://[::ffff:8.8.8.8]/')).toBe(true)
    expect(isAllowedUrl('http://[2606:4700:4700::1111]/')).toBe(true)
  })

  it('no longer blocks public names that merely start like a private range', () => {
    expect(isAllowedUrl('https://10.news.example.com/')).toBe(true)
  })
})

describe('isPrivateAddress', () => {
  it.each(['10.1.2.3', '127.0.0.1', '169.254.169.254', '192.168.1.1', '172.20.0.1', '0.0.0.0', '::1', '::ffff:10.0.0.1', 'fe80::1%eth0', 'garbage'])(
    'is true for %s',
    address => {
      expect(isPrivateAddress(address)).toBe(true)
    },
  )

  it.each(['93.184.216.34', '1.1.1.1', '2606:4700:4700::1111', '::ffff:93.184.216.34'])('is false for %s', address => {
    expect(isPrivateAddress(address)).toBe(false)
  })
})

describe('safeLookup', () => {
  const lookupResult = (addresses: { address: string; family: number }[]) =>
    mockDnsLookup.mockImplementation((_host: string, _opts: unknown, cb: (err: Error | null, a: unknown) => void) => cb(null, addresses))

  const run = () =>
    new Promise<{ err: Error | null; addresses: unknown }>(resolve => {
      safeLookup('feeds.example.com', {}, (err, addresses) => resolve({ err, addresses }))
    })

  it('passes every address through when all are public', async () => {
    lookupResult([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1::1', family: 6 },
    ])
    const { err, addresses } = await run()
    expect(err).toBeNull()
    expect(addresses).toHaveLength(2)
    expect(mockDnsLookup).toHaveBeenCalledWith('feeds.example.com', expect.objectContaining({ all: true }), expect.any(Function))
  })

  it('refuses a public name that resolves to a private address', async () => {
    lookupResult([{ address: '10.0.0.5', family: 4 }])
    const { err } = await run()
    expect(err).toBeInstanceOf(BlockedUrlError)
    expect(err?.message).toContain('10.0.0.5')
  })

  it('refuses when any one of several records is private', async () => {
    lookupResult([
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ])
    const { err } = await run()
    expect(err).toBeInstanceOf(BlockedUrlError)
  })

  it('passes DNS errors on', async () => {
    mockDnsLookup.mockImplementation((_h: string, _o: unknown, cb: (err: Error | null, a: unknown) => void) =>
      cb(Object.assign(new Error('nope'), { code: 'ENOTFOUND' }), []),
    )
    const { err } = await run()
    expect((err as NodeJS.ErrnoException).code).toBe('ENOTFOUND')
  })
})

describe('assertRedirectAllowed', () => {
  it('refuses a redirect to a private IP literal and allows a public URL', () => {
    expect(() => assertRedirectAllowed({ href: 'http://169.254.169.254/latest/meta-data' })).toThrow(BlockedUrlError)
    expect(() => assertRedirectAllowed({ protocol: 'http:', hostname: 'localhost', path: '/' })).toThrow(BlockedUrlError)
    expect(() => assertRedirectAllowed({ href: 'https://example.com/next' })).not.toThrow()
  })
})

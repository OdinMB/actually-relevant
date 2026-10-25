/**
 * SSRF guard for every server-side fetch of a URL that came from outside: article pages (from
 * third-party RSS feeds), feeds and favicons (admin-entered, and favicon `<link href>`s from the
 * fetched page). `.context/content-extraction.md`, "SSRF guard".
 *
 * Two layers: `isAllowedUrl` checks the URL itself (scheme, IP literals, names that only resolve
 * inside a network), and `safeLookup`, passed as axios' `lookup`, checks every address a name
 * resolves to at connect time, so a public name pointing at a private address is refused, on every
 * redirect too (follow-redirects reuses the options) and without a window for DNS rebinding.
 */
import { BlockList, isIP } from 'net'
import { lookup as dnsLookup, type LookupAddress, type LookupAllOptions } from 'dns'
import type { AxiosRequestConfig } from 'axios'

const blocked = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['172.16.0.0', 12],
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.168.0.0', 16],
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, broadcast
] as const) {
  blocked.addSubnet(network, prefix, 'ipv4')
}
for (const [network, prefix] of [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local (deprecated)
  ['ff00::', 8], // multicast
  ['2001:db8::', 32], // documentation
  ['100::', 64], // discard-only
] as const) {
  blocked.addSubnet(network, prefix, 'ipv6')
}

type IPv6Groups = [number, number, number, number, number, number, number, number]

/** The eight 16-bit groups of an IPv6 address (with or without a trailing dotted quad), or null. */
function ipv6Groups(address: string): IPv6Groups | null {
  let addr = address.toLowerCase()
  const quad = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(addr)
  if (quad) {
    const [a = 0, b = 0, c = 0, d = 0] = quad.slice(1).map(Number)
    addr = addr.slice(0, quad.index) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }
  const halves = addr.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const missing = 8 - head.length - tail.length
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail].map(g => parseInt(g, 16))
  return groups.length === 8 && groups.every(g => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? (groups as IPv6Groups) : null
}

/**
 * The IPv4 address an IPv6 address carries, for the forms that reach an IPv4 host: IPv4-mapped
 * (::ffff:a.b.c.d), IPv4-compatible (::a.b.c.d) and NAT64 (64:ff9b::a.b.c.d). Else null.
 */
function embeddedIPv4(address: string): string | null {
  const g = ipv6Groups(address)
  if (!g) return null
  const v4 = () => `${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`
  const zeros = (from: number, to: number) => g.slice(from, to).every(x => x === 0)
  if (zeros(0, 5) && g[5] === 0xffff) return v4()
  if (zeros(0, 6) && (g[6] !== 0 || g[7] > 1)) return v4()
  if (g[0] === 0x64 && g[1] === 0xff9b && zeros(2, 6)) return v4()
  return null
}

/** True for any address a fetch must not reach: private, loopback, link-local, reserved, or unparseable. */
export function isPrivateAddress(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, '').replace(/%.*$/, '') // brackets, IPv6 zone id
  const family = isIP(bare)
  if (family === 4) return blocked.check(bare, 'ipv4')
  if (family === 6) {
    const v4 = embeddedIPv4(bare)
    return v4 ? blocked.check(v4, 'ipv4') : blocked.check(bare, 'ipv6')
  }
  return true
}

/** Names that only resolve inside a network: localhost, mDNS, internal zones, and dotless names (Render's private service names). */
function isInternalHostname(hostname: string): boolean {
  return !hostname.includes('.') || /(^|\.)localhost$/i.test(hostname) || /\.(local|internal|localdomain|home\.arpa)$/i.test(hostname)
}

/**
 * Whether a URL may be fetched, judged from the URL alone: http(s) only, no private IP literal in
 * any spelling the URL parser accepts (it normalizes `2130706433` and `0x7f.1` to 127.0.0.1), no
 * internal or single-label name. A public name is allowed here; `safeLookup` checks what it
 * resolves to when the request connects.
 */
export function isAllowedUrl(urlStr: string): boolean {
  let url: URL
  try {
    url = new URL(urlStr)
  } catch {
    return false
  }

  if (!['http:', 'https:'].includes(url.protocol)) return false

  const hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (!hostname) return false
  if (isIP(hostname)) return !isPrivateAddress(hostname)
  return !isInternalHostname(hostname)
}

/** A request refused by the SSRF guard. */
export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BlockedUrlError'
  }
}

/**
 * `dns.lookup` that refuses a name resolving to any private address (all of them are checked, not
 * just the first, so a name cannot mix a public and a private record). Shaped as axios' `lookup`
 * option, which adapts the answer to what Node asks for. Node does not call it for IP literals;
 * `isAllowedUrl` covers those.
 */
export function safeLookup(hostname: string, options: object, callback: (err: Error | null, address: LookupAddress | LookupAddress[]) => void): void {
  const opts: LookupAllOptions = { ...(options as Omit<LookupAllOptions, 'all'>), all: true }
  dnsLookup(hostname, opts, (err, addresses) => {
    if (err) return callback(err, [])
    const privateHit = addresses.find(a => isPrivateAddress(a.address))
    if (privateHit) {
      return callback(new BlockedUrlError(`${hostname} resolves to a private address (${privateHit.address})`), [])
    }
    if (addresses.length === 0) return callback(Object.assign(new Error(`no address for ${hostname}`), { code: 'ENOTFOUND' }), [])
    callback(null, addresses)
  })
}

/** axios `beforeRedirect`: refuses a redirect to a URL `isAllowedUrl` rejects (IP literals included). */
export function assertRedirectAllowed(options: Record<string, unknown>): void {
  const redirectUrl = typeof options.href === 'string' ? options.href : `${String(options.protocol)}//${String(options.hostname)}${String(options.path ?? '')}`
  if (!isAllowedUrl(redirectUrl)) {
    throw new BlockedUrlError(`Blocked redirect to disallowed URL: ${redirectUrl}`)
  }
}

/** The axios options every guarded fetch spreads in: the resolving lookup and the redirect check. */
export const ssrfGuard: Pick<AxiosRequestConfig, 'lookup' | 'beforeRedirect'> = {
  // dns.LookupAddress' family is a number, axios' is 4 | 6; dns only ever answers those two
  lookup: safeLookup as AxiosRequestConfig['lookup'],
  beforeRedirect: assertRedirectAllowed,
}

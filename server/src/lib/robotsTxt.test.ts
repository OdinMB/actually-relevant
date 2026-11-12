import { describe, it, expect } from 'vitest'
import { isPathAllowed, matchesPathPattern, parseRobotsTxt } from './robotsTxt.js'

const TOKEN = 'ActuallyRelevant'
const allowed = (robots: string, path: string) => isPathAllowed(parseRobotsTxt(robots, TOKEN).rules, path)

describe('parseRobotsTxt: which group applies', () => {
  it('takes our own group over the * group, matching the product token case-insensitively', () => {
    const robots = ['User-agent: *', 'Disallow: /', '', 'User-agent: actuallyrelevant/1.0', 'Allow: /'].join('\n')
    const policy = parseRobotsTxt(robots, TOKEN)
    expect(policy.group).toBe('own')
    expect(allowed(robots, '/news/story')).toBe(true)
  })

  it('falls back to the * group when no group names us', () => {
    const robots = 'User-agent: *\nDisallow: /private/\n'
    expect(parseRobotsTxt(robots, TOKEN).group).toBe('any')
    expect(allowed(robots, '/private/page')).toBe(false)
    expect(allowed(robots, '/public/page')).toBe(true)
  })

  it('ignores groups that name only other bots', () => {
    const robots = ['User-agent: GPTBot', 'User-agent: ClaudeBot', 'User-agent: CCBot', 'User-agent: Google-Extended', 'Disallow: /'].join('\n')
    expect(parseRobotsTxt(robots, TOKEN).group).toBeNull()
    expect(allowed(robots, '/news/story')).toBe(true)
  })

  it('does not take a longer bot name that merely starts with our token as ours', () => {
    const robots = 'User-agent: ActuallyRelevantClone\nDisallow: /\n'
    expect(allowed(robots, '/news/story')).toBe(true)
  })

  it('counts consecutive user-agent lines as one group, and combines every group that names us', () => {
    const robots = ['User-agent: GPTBot', 'User-agent: ActuallyRelevant', 'Disallow: /a/', '', 'User-agent: ActuallyRelevant', 'Disallow: /b/'].join('\n')
    expect(allowed(robots, '/a/1')).toBe(false)
    expect(allowed(robots, '/b/1')).toBe(false)
    expect(allowed(robots, '/c/1')).toBe(true)
  })

  it('reads comments, CRLF line ends, odd key case and empty Disallow lines as RFC 9309 does', () => {
    const robots = '# our rules\r\nUSER-AGENT: * # everyone\r\nDISALLOW: /secret # keep out\r\nDisallow:\r\n'
    expect(allowed(robots, '/secret/x')).toBe(false)
    expect(allowed(robots, '/open')).toBe(true)
  })

  it('allows everything for an empty file or one without groups', () => {
    expect(allowed('', '/anything')).toBe(true)
    expect(allowed('<html><body>Not found</body></html>', '/anything')).toBe(true)
  })
})

describe('isPathAllowed: longest match', () => {
  it('uses the most specific rule, and lets Allow win a tie', () => {
    const robots = ['User-agent: *', 'Disallow: /news/', 'Allow: /news/public/', 'Disallow: /same', 'Allow: /same'].join('\n')
    expect(allowed(robots, '/news/secret')).toBe(false)
    expect(allowed(robots, '/news/public/story')).toBe(true)
    expect(allowed(robots, '/same')).toBe(true)
  })

  it('lets a longer Disallow override a shorter Allow', () => {
    const robots = 'User-agent: *\nAllow: /\nDisallow: /archive/\n'
    expect(allowed(robots, '/archive/2020')).toBe(false)
    expect(allowed(robots, '/today')).toBe(true)
  })

  it('measures specificity on the percent-encoded pattern, so a raw non-ASCII rule is not counted short', () => {
    const robots = 'User-agent: *\nAllow: /%C3%BCb\nDisallow: /über/\n'
    expect(allowed(robots, '/%c3%bcber/story')).toBe(false)
    expect(allowed(robots, '/%C3%BCbahn')).toBe(true)
  })

  it('matches the query string as part of the path', () => {
    const robots = 'User-agent: *\nDisallow: /*?print=\n'
    expect(allowed(robots, '/story?print=1')).toBe(false)
    expect(allowed(robots, '/story')).toBe(true)
  })
})

describe('matchesPathPattern', () => {
  it('matches a plain pattern as a prefix', () => {
    expect(matchesPathPattern('/news', '/news/story')).toBe(true)
    expect(matchesPathPattern('/news', '/new')).toBe(false)
  })

  it('matches * as any sequence and $ as the end', () => {
    expect(matchesPathPattern('/*.pdf$', '/files/report.pdf')).toBe(true)
    expect(matchesPathPattern('/*.pdf$', '/files/report.pdf?x=1')).toBe(false)
    expect(matchesPathPattern('/*/amp/', '/2026/amp/story')).toBe(true)
    expect(matchesPathPattern('/story$', '/story')).toBe(true)
    expect(matchesPathPattern('/story$', '/story/more')).toBe(false)
    expect(matchesPathPattern('*', '/anything')).toBe(true)
  })

  it('compares non-ASCII pattern characters with the percent-encoded path', () => {
    expect(matchesPathPattern('/über/', '/%C3%BCber/story')).toBe(true)
  })

  it('compares percent-encodings regardless of hex case, and unreserved characters encoded or not (RFC 9309 §2.2.2)', () => {
    const cyrillic = '/%d0%bd%d0%be%d0%b2%d0%be%d1%81%d1%82%d0%b8/' // "новости", lowercase hex
    expect(matchesPathPattern('/новости/', `${cyrillic}story`)).toBe(true)
    expect(matchesPathPattern(cyrillic, '/%D0%BD%D0%BE%D0%B2%D0%BE%D1%81%D1%82%D0%B8/story')).toBe(true)
    expect(matchesPathPattern('/~staff/', '/%7Estaff/page')).toBe(true)
    expect(matchesPathPattern('/%7estaff/', '/~staff/page')).toBe(true)
  })

  it('keeps an encoded reserved character distinct from the character itself', () => {
    expect(matchesPathPattern('/a%2Fb', '/a/b')).toBe(false)
    expect(matchesPathPattern('/a%2fb', '/a%2Fb')).toBe(true)
  })

  it('does not throw on a lone surrogate, which a tdmrep.json string can carry', () => {
    expect(matchesPathPattern(JSON.parse('"/\\ud800x"') as string, '/a')).toBe(false)
  })

  it('stays fast on a pattern full of wildcards that cannot match', () => {
    const pattern = '/' + 'a*'.repeat(40) + 'b'
    const path = '/' + 'a'.repeat(2000)
    const started = Date.now()
    expect(matchesPathPattern(pattern, path)).toBe(false)
    expect(Date.now() - started).toBeLessThan(500)
  })
})

describe('parseRobotsTxt: Content-Signal', () => {
  it('reads ai-input=no in the group that applies to us', () => {
    const robots = 'User-Agent: *\nContent-Signal: search=yes, ai-train=no, ai-input=no\nAllow: /\n'
    expect(parseRobotsTxt(robots, TOKEN).aiInputDenied).toBe(true)
  })

  it('reads ai-input=no at the top level, before any group', () => {
    const robots = 'Content-Signal: ai-input=no\n\nUser-agent: *\nAllow: /\n'
    expect(parseRobotsTxt(robots, TOKEN).aiInputDenied).toBe(true)
  })

  it('ignores training-only and search signals, and signals in groups for other bots', () => {
    expect(parseRobotsTxt('User-Agent: *\nContent-Signal: search=yes, ai-train=no\nAllow: /\n', TOKEN).aiInputDenied).toBe(false)
    expect(parseRobotsTxt('User-Agent: *\nContent-Signal: ai-input=yes\n', TOKEN).aiInputDenied).toBe(false)
    expect(parseRobotsTxt('User-Agent: GPTBot\nContent-Signal: ai-input=no\nDisallow: /\n', TOKEN).aiInputDenied).toBe(false)
  })

  it('uses the signal of our own group, not the * group, when both exist', () => {
    const robots = ['User-agent: *', 'Content-Signal: ai-input=no', '', 'User-agent: ActuallyRelevant', 'Content-Signal: ai-input=yes'].join('\n')
    expect(parseRobotsTxt(robots, TOKEN).aiInputDenied).toBe(false)
  })
})

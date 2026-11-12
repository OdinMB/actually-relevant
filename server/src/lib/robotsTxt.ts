/**
 * robots.txt as RFC 9309 reads it, for one crawler: the group for its product token, else the `*`
 * group; the most specific Allow/Disallow rule for a path, with `*` and `$` wildcards; and
 * Cloudflare-style `Content-Signal` lines (contentsignals.org), of which only `ai-input=no` counts.
 * Pure: fetching and caching are the caller's (services/publisherOptOut.ts).
 */

export interface RobotsRule {
  allow: boolean
  pattern: string
}

export interface RobotsPolicy {
  /** The group that applies: the crawler's own (its product token), the `*` group, or none (nothing is disallowed). */
  group: 'own' | 'any' | null
  /** The applicable groups' rules, combined (RFC 9309 merges every group that names the crawler). */
  rules: RobotsRule[]
  /** A Content-Signal with `ai-input=no` in the applicable group or before every group. */
  aiInputDenied: boolean
}

interface Group {
  agents: string[]
  rules: RobotsRule[]
  signals: string[]
}

/**
 * The product token a user-agent line names: its leading letters, `_` and `-`, lowercased, so
 * `ActuallyRelevant/1.0` names `actuallyrelevant` and `ActuallyRelevantClone` does not.
 */
function productTokenOf(value: string): string {
  return value === '*' ? '*' : (/^[A-Za-z_-]*/.exec(value)?.[0] ?? '').toLowerCase()
}

function deniesAiInput(signal: string): boolean {
  // key=value pairs anywhere in the value, so a leading path scope still counts (site-wide, the safe reading)
  for (const [, key, value] of signal.matchAll(/([a-z][a-z0-9-]*)\s*=\s*([a-z]+)/gi)) {
    if (key?.toLowerCase() === 'ai-input' && value?.toLowerCase() === 'no') return true
  }
  return false
}

export function parseRobotsTxt(text: string, productToken: string): RobotsPolicy {
  const groups: Group[] = []
  const topSignals: string[] = []
  let current: Group | null = null
  let collectingAgents = false

  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const key = line.slice(0, colon).trim().toLowerCase()
    const value = line.slice(colon + 1).trim()

    if (key === 'user-agent') {
      // Consecutive user-agent lines start one group; one after a rule starts the next
      if (!current || !collectingAgents) {
        current = { agents: [], rules: [], signals: [] }
        groups.push(current)
      }
      current.agents.push(productTokenOf(value))
      collectingAgents = true
    } else if (key === 'allow' || key === 'disallow') {
      collectingAgents = false
      // A rule before any group belongs to none; an empty Disallow disallows nothing
      if (current && value) current.rules.push({ allow: key === 'allow', pattern: value })
    } else if (key === 'content-signal') {
      collectingAgents = false
      ;(current ? current.signals : topSignals).push(value)
    }
  }

  const token = productToken.toLowerCase()
  const own = groups.filter(g => g.agents.includes(token))
  const any = groups.filter(g => g.agents.includes('*'))
  const applicable = own.length ? own : any
  const signals = [...topSignals, ...applicable.flatMap(g => g.signals)]
  return {
    group: own.length ? 'own' : any.length ? 'any' : null,
    rules: applicable.flatMap(g => g.rules),
    aiInputDenied: signals.some(deniesAiInput),
  }
}

/** Whether the rules let the crawler fetch this path (pathname plus query): the longest matching rule wins, Allow on a tie, and no match allows. */
export function isPathAllowed(rules: readonly RobotsRule[], path: string): boolean {
  let best: RobotsRule | null = null
  for (const rule of rules) {
    if (!matchesPathPattern(rule.pattern, path)) continue
    if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow)) best = rule
  }
  return best?.allow ?? true
}

/**
 * Whether a robots.txt path pattern matches the path: a prefix match, where `*` stands for any
 * sequence and a final `$` anchors the end. Non-ASCII pattern characters are compared in the
 * percent-encoded form a URL's path carries. Linear-time wildcard matching (no regex), so a
 * publisher's pattern cannot make a match backtrack catastrophically.
 */
export function matchesPathPattern(pattern: string, path: string): boolean {
  const encoded = pattern.replace(/[^ -~]/gu, c => encodeURIComponent(c))
  const anchored = encoded.endsWith('$')
  const p = anchored ? encoded.slice(0, -1) : `${encoded}*`
  let pi = 0
  let si = 0
  let starPi = -1
  let starSi = 0
  while (si < path.length) {
    if (p[pi] === '*') {
      starPi = pi++
      starSi = si
    } else if (pi < p.length && p[pi] === path[si]) {
      pi++
      si++
    } else if (starPi >= 0) {
      pi = starPi + 1
      si = ++starSi
    } else {
      return false
    }
  }
  while (p[pi] === '*') pi++
  return pi === p.length
}

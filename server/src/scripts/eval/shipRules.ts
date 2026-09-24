/**
 * The owner's rules for the prompt changes that ship with the phase-2 model
 * switch (decided 2026-09-24), apart from the rating recalibration in
 * recalibration.ts: a social post names the story's main actor or one key
 * number and stays faithful to the story; editorial selection still returns
 * exactly N picks now that candidates carry publication dates. Pure.
 */
import type { StoryForBlueskyPost } from '../../prompts/bluesky.js'
import { checkSocialPost, forbiddenContent, pct } from './checks.js'
import type { SelectionGroup, SocialPostItem } from './fixtures.js'
import { findUnsupportedNumbers } from './numbers.js'
import type { Criterion } from './recalibration.js'
import { findStoryAnchors, findUnstatedNames } from './storyAnchors.js'
import type { SelectionArmMetrics } from './suites/largeTier.js'

// ---------------------------------------------------------------------------
// Social post text
// ---------------------------------------------------------------------------

export interface ShipPostCheck {
  item: SocialPostItem
  text: string
  /** The story's names and numbers the post repeats; the owner asks for at least one. */
  anchors: string[]
  /** Numbers the story does not state (embellishment). */
  unsupported: string[]
  /** Names the story never mentions: pointers for the spot check, not failures. */
  unstatedNames: string[]
  overLimit: boolean
  forbidden: boolean
  extraEmDash: boolean
}

/** Everything the post prompt shows the model about the story. */
const storyText = (s: StoryForBlueskyPost) => [s.title, s.summary, s.relevanceSummary ?? ''].join('\n')

export function checkShipPost(item: SocialPostItem, text: string): ShipPostCheck {
  const story = storyText(item.story)
  const rules = checkSocialPost(text, { platform: item.platform, maxChars: item.story.maxChars, title: item.story.title })
  return {
    item,
    text,
    anchors: findStoryAnchors(text, story),
    unsupported: findUnsupportedNumbers(text, story).unsupported,
    unstatedNames: findUnstatedNames(text, story),
    overLimit: rules.overLimit,
    forbidden: forbiddenContent(rules),
    extraEmDash: rules.extraEmDash,
  }
}

function noneOf(name: string, checks: ShipPostCheck[], hit: (c: ShipPostCheck) => boolean, source: string, required = true): Criterion {
  const n = checks.filter(hit).length
  return { name, value: `${n} of ${checks.length}`, bar: `0 (${source})`, pass: checks.length > 0 && n === 0, required }
}

export function socialPostCriteria(checks: ShipPostCheck[], failedCalls: number): Criterion[] {
  const anchored = checks.filter(c => c.anchors.length > 0).length
  return [
    {
      name: 'Posts naming the story\'s actor or a key number',
      value: `${anchored} of ${checks.length}`,
      bar: 'all (owner, phase 2)',
      pass: checks.length > 0 && anchored === checks.length,
      required: true,
    },
    noneOf('Raw drafts over the length limit', checks, c => c.overLimit, 'owner'),
    noneOf('Drafts with numbers the story does not state', checks, c => c.unsupported.length > 0, 'owner: no embellishment'),
    noneOf('Drafts with forbidden content', checks, c => c.forbidden, 'prompt rules'),
    noneOf('Drafts with more than one em dash', checks, c => c.extraEmDash, 'house style, not required', false),
    noneOf('Drafts naming someone the story does not mention', checks, c => c.unstatedNames.length > 0, 'spot check, not required', false),
    { name: 'Failed calls', value: String(failedCalls), bar: '0', pass: failedCalls === 0, required: true },
  ]
}

// ---------------------------------------------------------------------------
// Editorial selection
// ---------------------------------------------------------------------------

/** The stale probe's publication date: years before any fixture day. */
export const STALE_DATE = '2023-06-01T00:00:00.000Z'

/**
 * One candidate per group re-dated as stale news: the first one production
 * selected, so it is a story the models tend to want. Whether a pick list
 * keeps it shows whether the model reads the date. Null when production
 * selected none of the group.
 */
export function staleProbeId(g: SelectionGroup): string | null {
  return g.stories.find(s => g.storedPicked.includes(s.id))?.id ?? null
}

/**
 * The group as the replay shows it. A story cached before fixtures carried the
 * date has no `sourceDatePublished` key and gets its group's crawl day; a
 * sampled null stays null ("unknown", as production shows it); the probe gets
 * STALE_DATE.
 */
export function datedForReplay(g: SelectionGroup, probeId: string | null): SelectionGroup {
  return {
    ...g,
    stories: g.stories.map(s => ({
      ...s,
      sourceDatePublished: s.id === probeId ? STALE_DATE : s.sourceDatePublished === undefined ? `${g.day}T00:00:00.000Z` : s.sourceDatePublished,
    })),
  }
}

/** Probes a list of pick lists kept, over the groups that had a probe and an answer. */
export function staleProbesKept(probes: (string | null)[], picks: (string[] | null)[]): { kept: number; probed: number } {
  const scored = probes.flatMap((p, i) => (p != null && picks[i] != null ? [picks[i].includes(p)] : []))
  return { kept: scored.filter(Boolean).length, probed: scored.length }
}

const zero = (name: string, n: number): Criterion => ({ name, value: String(n), bar: '0 (phase 1: gpt-6-sol 0)', pass: n === 0, required: true })

/** The large tier's gate, unchanged from phase 1: every group answered with exactly N valid IDs. */
export function selectionCriteria(m: SelectionArmMetrics): Criterion[] {
  return [
    { name: 'Exact count, valid unique IDs', value: pct(m.exactCount), bar: '100% (phase 1: gpt-6-sol 100%)', pass: m.exactCount === 1, required: true },
    zero('Invalid IDs returned', m.invalidIds),
    zero('Declined or empty responses', m.declined),
    zero('Failed calls', m.failures),
  ]
}

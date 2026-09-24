/**
 * The owner's rules for the prompt changes that ship with the phase-2 model
 * switch (decided 2026-09-24), apart from the rating recalibration in
 * recalibration.ts: a social post names the story's main actor or one key
 * number and stays faithful to the story. Pure.
 */
import type { StoryForBlueskyPost } from '../../prompts/bluesky.js'
import { checkSocialPost, forbiddenContent } from './checks.js'
import type { SocialPostItem } from './fixtures.js'
import { findUnsupportedNumbers } from './numbers.js'
import type { Criterion } from './recalibration.js'
import { findStoryAnchors, findUnstatedNames } from './storyAnchors.js'

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

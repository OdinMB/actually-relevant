/**
 * The cached prompts' prefix tests (`.context/prompting.md`, "Prompt caching"): each cached builder,
 * built for two different inputs, has a byte-identical stable part, so every call after the first
 * within the cache's lifetime reads it; and its whole text is the stable part and the data joined.
 */
import { describe, expect, it } from 'vitest'
import { promptText, type PromptParts } from '../lib/promptCache.js'
import { buildAssessPrompt, buildAssessPromptParts } from './assess.js'
import { buildPreassessPrompt, buildPreassessPromptParts } from './preassess.js'

const guidelines = (n: number) => ({ factors: `factor ${n}`, antifactors: `antifactor ${n}`, ratings: `ratings ${n}` })
const issues = [
  { slug: 'planet', name: 'Planet', description: 'Climate and nature' },
  { slug: 'science', name: 'Science', description: 'Discoveries' },
]

/** Two different calls of one cached builder, and the plain text of the first. */
interface Case {
  name: string
  first: PromptParts
  second: PromptParts
  text: string
  /** Values of the two calls that must sit in the data, never in the stable part. */
  callValues: string[]
}

const cases: Case[] = [
  {
    name: 'assess',
    first: buildAssessPromptParts('Rooftop solar doubles', 'Pakistan added 22GW.', 'Dawn', 'https://a.example/1', guidelines(1)),
    second: buildAssessPromptParts('Polio nearly gone', 'Cases fell to 60.', 'BBC', 'https://b.example/2', guidelines(2), 'uplifting'),
    text: buildAssessPrompt('Rooftop solar doubles', 'Pakistan added 22GW.', 'Dawn', 'https://a.example/1', guidelines(1)),
    callValues: ['Rooftop solar doubles', 'Pakistan added 22GW.', 'Dawn', 'factor 1', 'Polio nearly gone', 'factor 2', '<TONE>'],
  },
  {
    name: 'preassess',
    first: buildPreassessPromptParts([{ id: 'a1', title: 'Solar', content: 'Rooftop solar doubles.' }], issues),
    second: buildPreassessPromptParts(
      [
        { id: 'b1', title: 'Polio', content: 'Cases fell.' },
        { id: 'b2', title: 'Flood', content: 'A river burst its banks.' },
      ],
      issues,
    ),
    text: buildPreassessPrompt([{ id: 'a1', title: 'Solar', content: 'Rooftop solar doubles.' }], issues),
    callValues: ['a1', 'Rooftop solar doubles.', 'b2', 'A river burst its banks.'],
  },
]

describe('cached prompts', () => {
  it.each(cases)('$name: the stable part is byte-identical across calls', ({ first, second }) => {
    expect(second.stable).toBe(first.stable)
    expect(first.data).not.toBe(second.data)
  })

  it.each(cases)('$name: the whole text is the stable part and the data, as the plain builder returns it', ({ first, text }) => {
    expect(promptText(first)).toBe(text)
    expect(first.stable.endsWith('\n\n')).toBe(true)
  })

  it.each(cases)("$name: the call's own values sit in the data", ({ first, second, callValues }) => {
    for (const value of callValues) expect(first.stable).not.toContain(value)
    for (const value of callValues) expect(first.data + second.data).toContain(value)
  })
})

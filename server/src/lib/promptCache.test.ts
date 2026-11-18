import { describe, it, expect } from 'vitest'
import { promptCacheOptions, promptKey, promptMessage, promptParts, promptText, takesCacheControls } from './promptCache.js'

describe('takesCacheControls', () => {
  it('takes GPT-6 ids, their point releases and snapshots, and GPT-5.6 on', () => {
    for (const id of ['gpt-6-luna', 'gpt-6-sol', 'gpt-6.1-sol', 'gpt-6.1-sol-2026-09-29', 'gpt-6', 'gpt-5.6', 'gpt-5.6-mini', 'gpt-5.10']) {
      expect(takesCacheControls(id)).toBe(true)
    }
  })

  it('leaves older and unknown ids alone, so no request carries options a model may reject', () => {
    for (const id of ['gpt-5-mini', 'gpt-5-nano', 'gpt-5.2', 'gpt-5.5', 'gpt-5', 'gpt-60', 'gpt-4o', 'o3', 'text-embedding-3-small', 'unknown']) {
      expect(takesCacheControls(id)).toBe(false)
    }
    expect(promptCacheOptions('gpt-5-mini')).toBeUndefined()
    expect(promptCacheOptions('gpt-6-luna')).toEqual({ mode: 'explicit' })
  })
})

describe('promptMessage', () => {
  const parts = promptParts('<RULES>\nRules.\n</RULES>', '<DATA>\nData.\n</DATA>')

  it('joins the two parts into the text the builder returned before it was split', () => {
    expect(promptText(parts)).toBe('<RULES>\nRules.\n</RULES>\n\n<DATA>\nData.\n</DATA>')
    expect(promptText('plain')).toBe('plain')
  })

  it('sends a split prompt as two text blocks, the breakpoint after the stable one, to a model that takes the controls', () => {
    expect(promptMessage(parts, 'gpt-6-luna').content).toEqual([
      { type: 'text', text: parts.stable, prompt_cache_breakpoint: { mode: 'explicit' } },
      { type: 'text', text: parts.data },
    ])
  })

  it('sends the whole text to any other model, and a plain prompt as it is', () => {
    expect(promptMessage(parts, 'gpt-5-mini').content).toBe(promptText(parts))
    expect(promptMessage('plain', 'gpt-6-luna').content).toBe('plain')
  })

  it('keys a split prompt apart from the same text sent whole, only where the split is sent', () => {
    expect(promptKey(parts, 'gpt-6-luna')).not.toBe(promptText(parts))
    expect(promptKey(parts, 'gpt-5-mini')).toBe(promptText(parts))
    expect(promptKey('plain', 'gpt-6-luna')).toBe('plain')
  })
})

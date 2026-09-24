import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { ChatOpenAI } from '@langchain/openai'

// config.ts reads OPENAI_MODEL_* / OPENAI_EFFORT_* at import time, so every
// test re-imports the modules after stubbing the environment.
async function loadLlm() {
  vi.resetModules()
  return import('./llm.js')
}

async function loadConfig() {
  vi.resetModules()
  return import('../config.js')
}

/** The Chat Completions request parameters (the declared type is a Responses/Completions union). */
function paramsOf(llm: ChatOpenAI): Record<string, unknown> {
  return { ...llm.invocationParams() }
}

const TIER_ENV_VARS = [
  'OPENAI_MODEL_SMALL', 'OPENAI_MODEL_MEDIUM', 'OPENAI_MODEL_LARGE',
  'OPENAI_EFFORT_SMALL', 'OPENAI_EFFORT_MEDIUM', 'OPENAI_EFFORT_LARGE',
]

describe('llm client construction', () => {
  beforeEach(() => {
    // Neutralise any tier overrides from the developer's shell.
    for (const name of TIER_ENV_VARS) vi.stubEnv(name, '')
    vi.stubEnv('OPENAI_API_KEY', '')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('createChatModel', () => {
    it('sends reasoning effort for gpt-6 IDs and no sampling or token-limit params', async () => {
      const { createChatModel } = await loadLlm()
      const params = paramsOf(createChatModel({ name: 'gpt-6-luna', reasoningEffort: 'low' }))
      expect(params.reasoning_effort).toBe('low')
      expect(params.temperature).toBeUndefined()
      expect(params.top_p).toBeUndefined()
      expect(params.max_tokens).toBeUndefined()
      expect(params.max_completion_tokens).toBeUndefined()
    })

    it('keeps the same request for gpt-5 models', async () => {
      const { createChatModel } = await loadLlm()
      const params = paramsOf(createChatModel({ name: 'gpt-5-mini', reasoningEffort: 'medium' }))
      expect(params.model).toBe('gpt-5-mini')
      expect(params.reasoning_effort).toBe('medium')
      expect(params.temperature).toBeUndefined()
      expect(params.max_completion_tokens).toBeUndefined()
    })

    it('keeps the effort on the structured-output path (withConfig rebuilds the model)', async () => {
      const { createChatModel } = await loadLlm()
      const rebuilt = createChatModel({ name: 'gpt-6-luna', reasoningEffort: 'low' }).withConfig({}) as ChatOpenAI
      expect(paramsOf(rebuilt).reasoning_effort).toBe('low')
    })

    it('rejects minimal effort on gpt-6 models', async () => {
      const { createChatModel } = await loadLlm()
      expect(() => createChatModel({ name: 'gpt-6-luna', reasoningEffort: 'minimal' })).toThrow(/minimal/)
    })

    it('rejects none effort on gpt-5-nano and gpt-5-mini', async () => {
      const { createChatModel } = await loadLlm()
      expect(() => createChatModel({ name: 'gpt-5-nano', reasoningEffort: 'none' })).toThrow(/none/)
      expect(() => createChatModel({ name: 'gpt-5-mini', reasoningEffort: 'none' })).toThrow(/none/)
    })

    it('constructs without an API key', async () => {
      const { createChatModel } = await loadLlm()
      expect(() => createChatModel({ name: 'gpt-6-sol', reasoningEffort: 'medium' })).not.toThrow()
    })
  })

  describe('tier getters', () => {
    it('apply model and effort overrides from the environment', async () => {
      vi.stubEnv('OPENAI_MODEL_SMALL', 'gpt-6-luna')
      vi.stubEnv('OPENAI_EFFORT_SMALL', 'low')
      const { getSmallLLM } = await loadLlm()
      const params = paramsOf(getSmallLLM())
      expect(params.model).toBe('gpt-6-luna')
      expect(params.reasoning_effort).toBe('low')
    })

    it('default to the current production models at medium effort', async () => {
      const { getSmallLLM, getMediumLLM, getLargeLLM } = await loadLlm()
      const tiers = [getSmallLLM(), getMediumLLM(), getLargeLLM()].map(paramsOf)
      expect(tiers.map(p => p.model)).toEqual(['gpt-5-nano', 'gpt-5-mini', 'gpt-5.2'])
      expect(tiers.map(p => p.reasoning_effort)).toEqual(['medium', 'medium', 'medium'])
    })
  })
})

describe('parseEffort', () => {
  it('returns the fallback for unset or empty values', async () => {
    const { parseEffort } = await loadConfig()
    expect(parseEffort(undefined, 'medium', 'OPENAI_EFFORT_SMALL')).toBe('medium')
    expect(parseEffort('', 'high', 'OPENAI_EFFORT_SMALL')).toBe('high')
  })

  it('accepts every documented effort', async () => {
    const { parseEffort, REASONING_EFFORTS } = await loadConfig()
    for (const effort of REASONING_EFFORTS) {
      expect(parseEffort(effort, 'medium', 'OPENAI_EFFORT_SMALL')).toBe(effort)
    }
  })

  it('throws on an unknown value, naming the variable', async () => {
    const { parseEffort } = await loadConfig()
    expect(() => parseEffort('lo', 'medium', 'OPENAI_EFFORT_SMALL')).toThrow(/OPENAI_EFFORT_SMALL/)
  })
})

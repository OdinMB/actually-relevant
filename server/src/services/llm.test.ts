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

const TIER_ENV_VARS = ['OPENAI_MODEL_SMALL', 'OPENAI_MODEL_MEDIUM', 'OPENAI_MODEL_LARGE', 'OPENAI_EFFORT_SMALL', 'OPENAI_EFFORT_MEDIUM', 'OPENAI_EFFORT_LARGE']

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

    it('rejects none effort on gpt-6.1-sol and its dated snapshots, and keeps it for gpt-6-sol', async () => {
      const { createChatModel } = await loadLlm()
      expect(() => createChatModel({ name: 'gpt-6.1-sol', reasoningEffort: 'none' })).toThrow(/none/)
      expect(() => createChatModel({ name: 'gpt-6.1-sol-2026-09-29', reasoningEffort: 'none' })).toThrow(/none/)
      expect(() => createChatModel({ name: 'gpt-6.1-sol', reasoningEffort: 'low' })).not.toThrow()
      expect(() => createChatModel({ name: 'gpt-6-sol', reasoningEffort: 'none' })).not.toThrow()
    })

    it('constructs without an API key', async () => {
      const { createChatModel } = await loadLlm()
      expect(() => createChatModel({ name: 'gpt-6-sol', reasoningEffort: 'medium' })).not.toThrow()
    })

    it('turns caching off unless a prompt marks it, for models that take the controls only', async () => {
      const { createChatModel } = await loadLlm()
      expect(paramsOf(createChatModel({ name: 'gpt-6-luna', reasoningEffort: 'low' })).prompt_cache_options).toEqual({ mode: 'explicit' })
      expect(paramsOf(createChatModel({ name: 'gpt-6.1-sol', reasoningEffort: 'medium' })).prompt_cache_options).toEqual({ mode: 'explicit' })
      expect(paramsOf(createChatModel({ name: 'gpt-5-mini', reasoningEffort: 'medium' })).prompt_cache_options).toBeUndefined()
      expect(paramsOf(createChatModel({ name: 'some-future-model', reasoningEffort: 'medium' })).prompt_cache_options).toBeUndefined()
    })
  })

  describe('the request body', () => {
    const answer = () =>
      new Response(
        JSON.stringify({
          id: 'x',
          object: 'chat.completion',
          created: 0,
          model: 'm',
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '{"ok":true}' } }],
          usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )

    async function sent(model: string, split: boolean): Promise<Record<string, unknown>> {
      vi.stubEnv('OPENAI_API_KEY', 'test-key-not-real')
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(answer())
      vi.stubGlobal('fetch', fetchMock)
      try {
        const { z } = await import('zod')
        const { createChatModel } = await loadLlm()
        const { promptMessage, promptParts } = await import('../lib/promptCache.js')
        const prompt = split ? promptParts('Stable rules.', 'Call data.') : 'Stable rules.\n\nCall data.'
        await createChatModel({ name: model, reasoningEffort: 'low' })
          .withStructuredOutput(z.object({ ok: z.boolean() }))
          .invoke([promptMessage(prompt, model)])
        return JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>
      } finally {
        vi.unstubAllGlobals()
      }
    }

    it('carries explicit mode and the breakpoint after the stable part for a split prompt on gpt-6', async () => {
      const body = await sent('gpt-6-luna', true)
      expect(body.prompt_cache_options).toEqual({ mode: 'explicit' })
      expect(body.reasoning_effort).toBe('low')
      expect(body.messages).toEqual([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Stable rules.\n\n', prompt_cache_breakpoint: { mode: 'explicit' } },
            { type: 'text', text: 'Call data.' },
          ],
        },
      ])
    })

    it('carries explicit mode and no breakpoint for a plain prompt: nothing is cached or written', async () => {
      const body = await sent('gpt-6-luna', false)
      expect(body.prompt_cache_options).toEqual({ mode: 'explicit' })
      expect(body.messages).toEqual([{ role: 'user', content: 'Stable rules.\n\nCall data.' }])
    })

    it('sends neither to a model without the controls, the split prompt as its whole text', async () => {
      const body = await sent('gpt-5-mini', true)
      expect(body).not.toHaveProperty('prompt_cache_options')
      expect(body.messages).toEqual([{ role: 'user', content: 'Stable rules.\n\nCall data.' }])
    })
  })

  describe('getLLMAtEffort', () => {
    it("gives a tier's own client at its own effort, and a client at another effort apart from it", async () => {
      const { getLLMAtEffort, getSmallLLM } = await loadLlm()
      const { config } = await import('../config.js')
      expect(getLLMAtEffort('small', config.llm.models.small.reasoningEffort)).toBe(getSmallLLM())
      const lower = getLLMAtEffort('small', 'none')
      expect(paramsOf(lower).reasoning_effort).toBe('none')
      expect(paramsOf(lower).model).toBe(config.llm.models.small.name)
      expect(getLLMAtEffort('small', 'none')).toBe(lower)
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

    it('fall back to a model and a valid effort when the environment leaves the variables blank', async () => {
      const { getSmallLLM, getMediumLLM, getLargeLLM } = await loadLlm()
      const { REASONING_EFFORTS } = await import('../config.js')
      const tiers = [getSmallLLM(), getMediumLLM(), getLargeLLM()].map(paramsOf)
      for (const p of tiers) {
        expect(p.model).toMatch(/^gpt-/)
        expect(REASONING_EFFORTS).toContain(p.reasoning_effort)
      }
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

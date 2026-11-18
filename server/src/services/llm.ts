import { ChatOpenAI } from '@langchain/openai'
import { config, type ReasoningEffort } from '../config.js'
import { promptCacheOptions } from '../lib/promptCache.js'
import { openAiFetch } from './openaiFetch.js'

export interface ChatModelSpec {
  name: string
  reasoningEffort: ReasoningEffort
}

/**
 * Build a ChatOpenAI client. Every chat model in the server (tier getters,
 * backfill scripts, eval harness) goes through here.
 *
 * Effort travels as `modelKwargs: { reasoning_effort }`, not the `reasoning`
 * option: @langchain/openai forwards `reasoning` only for IDs on its own list
 * of reasoning models (`o*`, `gpt-5*`, and `gpt-6*` since 1.5.14) and silently
 * drops it for any other ID. modelKwargs is spread into every Chat Completions
 * request whatever the model ID, so an override to a model LangChain does not
 * know yet still gets its effort.
 *
 * Prompt caching is off unless a prompt asks for it (`lib/promptCache.ts`): a model that takes the
 * cache controls (GPT-5.6 and later, GPT-6) gets `prompt_cache_options: { mode: 'explicit' }`, so
 * only the breakpoint a split prompt places is cached; any other id gets OpenAI's default.
 *
 * GPT-6 rules for anyone extending this:
 * - Never add `temperature`, `topP` or `maxTokens`. GPT-6 rejects sampling
 *   params above effort `none`.
 * - Never use `withStructuredOutput(..., { method: 'functionCalling' })` or
 *   bind tools: GPT-6 Chat Completions function calling only works at effort
 *   `none`. The default structured-output method (response_format json_schema)
 *   is fine.
 */
export function createChatModel(spec: ChatModelSpec): ChatOpenAI {
  assertEffortSupported(spec)
  const cache = promptCacheOptions(spec.name)
  return new ChatOpenAI({
    model: spec.name,
    modelKwargs: { reasoning_effort: spec.reasoningEffort },
    ...(cache ? { promptCacheOptions: cache } : {}),
    maxRetries: 3,
    // Flex answers can be slow: every call waits as long as a flex call may need
    timeout: config.llm.flex.timeoutMs,
    // Flex processing and usage recording inside a job run (services/openaiFetch.ts)
    configuration: { fetch: openAiFetch },
  })
}

/** Why `model` rejects `effort`, as the API is documented to; null when it takes it. */
function effortRefusal(name: string, reasoningEffort: ReasoningEffort): string | null {
  if (reasoningEffort === 'minimal' && !name.startsWith('gpt-5')) return `Reasoning effort "minimal" is not supported by ${name}; use "low"`
  if (reasoningEffort === 'none' && /^gpt-5-(mini|nano)\b/.test(name)) return `Reasoning effort "none" is not supported by ${name}; use "minimal" or higher`
  // OpenAI's "Using GPT-6" guide: GPT-6.1 Sol (like GPT-6 Astra) does not support none.
  if (reasoningEffort === 'none' && /^gpt-6\.1-sol\b/.test(name)) return `Reasoning effort "none" is not supported by ${name}; use "low" or higher`
  return null
}

/** Whether `name` takes `effort`: the combinations `createChatModel` refuses are the API's documented rejections. */
export const effortSupported = (name: string, effort: ReasoningEffort): boolean => effortRefusal(name, effort) === null

/** Fail at construction for combinations the API is documented to reject. */
function assertEffortSupported({ name, reasoningEffort }: ChatModelSpec): void {
  const refusal = effortRefusal(name, reasoningEffort)
  if (refusal) throw new Error(refusal)
}

let nextAvailableTime = 0

export async function rateLimitDelay(): Promise<void> {
  const now = Date.now()
  const waitUntil = Math.max(nextAvailableTime, now)
  nextAvailableTime = waitUntil + config.llm.delayMs
  const waitMs = waitUntil - now
  if (waitMs > 0) {
    await new Promise(resolve => setTimeout(resolve, waitMs))
  }
}

let _smallLLM: ChatOpenAI | null = null
let _mediumLLM: ChatOpenAI | null = null
let _largeLLM: ChatOpenAI | null = null

export function getSmallLLM(): ChatOpenAI {
  if (!_smallLLM) _smallLLM = createChatModel(config.llm.models.small)
  return _smallLLM
}

export function getMediumLLM(): ChatOpenAI {
  if (!_mediumLLM) _mediumLLM = createChatModel(config.llm.models.medium)
  return _mediumLLM
}

export function getLargeLLM(): ChatOpenAI {
  if (!_largeLLM) _largeLLM = createChatModel(config.llm.models.large)
  return _largeLLM
}

export function getLLMByTier(tier: 'small' | 'medium' | 'large'): ChatOpenAI {
  switch (tier) {
    case 'small':
      return getSmallLLM()
    case 'medium':
      return getMediumLLM()
    case 'large':
      return getLargeLLM()
  }
}

const _atEffort = new Map<string, ChatOpenAI>()

/** A tier's model at another effort (a step that asks for less, `config.research.extractionEffort`); the tier's own client at its own. */
export function getLLMAtEffort(tier: 'small' | 'medium' | 'large', effort: ReasoningEffort): ChatOpenAI {
  const spec = config.llm.models[tier]
  if (effort === spec.reasoningEffort) return getLLMByTier(tier)
  const key = `${tier}@${effort}`
  let llm = _atEffort.get(key)
  if (!llm) {
    llm = createChatModel({ name: spec.name, reasoningEffort: effort })
    _atEffort.set(key, llm)
  }
  return llm
}

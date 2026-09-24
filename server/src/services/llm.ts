import { ChatOpenAI } from '@langchain/openai'
import { config, type ReasoningEffort } from '../config.js'

export interface ChatModelSpec {
  name: string
  reasoningEffort: ReasoningEffort
}

/**
 * Build a ChatOpenAI client. Every chat model in the server (tier getters,
 * backfill scripts, eval harness) goes through here.
 *
 * Effort travels as `modelKwargs: { reasoning_effort }`, not the `reasoning`
 * option: @langchain/openai forwards `reasoning` only for IDs it recognises as
 * reasoning models (`o*`, `gpt-5*`) and silently drops it for gpt-6-*.
 * modelKwargs is spread into every Chat Completions request, so gpt-5 models
 * get the same parameters as before.
 *
 * GPT-6 rules for anyone extending this:
 * - Never add `temperature`, `topP` or `maxTokens`. GPT-6 rejects sampling
 *   params above effort `none`, and LangChain would send `max_tokens`
 *   (not `max_completion_tokens`) for gpt-6-* IDs.
 * - Never use `withStructuredOutput(..., { method: 'functionCalling' })` or
 *   bind tools: GPT-6 Chat Completions function calling only works at effort
 *   `none`. The default structured-output method (response_format json_schema)
 *   is fine.
 */
export function createChatModel(spec: ChatModelSpec): ChatOpenAI {
  assertEffortSupported(spec)
  return new ChatOpenAI({
    model: spec.name,
    modelKwargs: { reasoning_effort: spec.reasoningEffort },
    maxRetries: 3,
  })
}

/** Fail at construction for combinations the API is documented to reject. */
function assertEffortSupported({ name, reasoningEffort }: ChatModelSpec): void {
  if (reasoningEffort === 'minimal' && !name.startsWith('gpt-5')) {
    throw new Error(`Reasoning effort "minimal" is not supported by ${name}; use "low"`)
  }
  if (reasoningEffort === 'none' && /^gpt-5-(mini|nano)\b/.test(name)) {
    throw new Error(`Reasoning effort "none" is not supported by ${name}; use "minimal" or higher`)
  }
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
    case 'small': return getSmallLLM()
    case 'medium': return getMediumLLM()
    case 'large': return getLargeLLM()
  }
}

/**
 * What one structured-output call returned, read the same way wherever the cost counts: the token
 * usage, finish reason and text of a raw LangChain message, and the call's outcome. Shared by the
 * model eval (`scripts/eval/models.ts`) and story research (`services/researchCalls.ts`), so the
 * eval's numbers and the research cap read usage alike.
 */
import type { AIMessage } from '@langchain/core/messages'

/**
 * `skipped` is harness-level (budget used up, no call made); the other outcomes describe what the
 * model returned.
 */
export type LlmCallOutcome = 'ok' | 'parse_failure' | 'empty' | 'truncated' | 'error' | 'skipped'

export interface LlmTokenUsage {
  input: number
  /** Input tokens served from the prompt cache (subset of `input`). */
  cached: number
  /**
   * Input tokens written to the prompt cache (subset of `input`, apart from `cached`), billed at the
   * write price. Absent on usage recorded before 2026-11-18, which counted none.
   */
  cacheWrite?: number
  /** Billed output tokens, reasoning included. */
  output: number
  /** Reasoning tokens (subset of `output`). */
  reasoning: number
}

export const ZERO_USAGE: LlmTokenUsage = { input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0 }

export function usageFrom(message: AIMessage): LlmTokenUsage {
  const u = message.usage_metadata
  return {
    input: u?.input_tokens ?? 0,
    cached: u?.input_token_details?.cache_read ?? 0,
    cacheWrite: u?.input_token_details?.cache_creation ?? 0,
    output: u?.output_tokens ?? 0,
    reasoning: u?.output_token_details?.reasoning ?? 0,
  }
}

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

/** The token counts of a raw Chat Completions, Responses or Embeddings answer: cache reads (`cached`) and writes (`cacheWrite`) are parts of `input`. */
export function tokensOf(json: unknown): { input: number; cached: number; cacheWrite: number; output: number } {
  const usage = (json as { usage?: Record<string, unknown> } | null)?.usage
  if (!usage) return { input: 0, cached: 0, cacheWrite: 0, output: 0 }
  // Chat Completions and Embeddings: prompt_/completion_tokens; Responses: input_/output_tokens
  const input = num(usage.prompt_tokens ?? usage.input_tokens)
  const details = (usage.prompt_tokens_details ?? usage.input_tokens_details) as Record<string, unknown> | undefined
  return {
    input,
    cached: num(details?.cached_tokens),
    cacheWrite: num(details?.cache_write_tokens),
    output: num(usage.completion_tokens ?? usage.output_tokens),
  }
}

export function contentText(message: AIMessage): string {
  return typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
}

export function finishReasonOf(message: AIMessage): string | null {
  const reason = message.response_metadata?.finish_reason
  return typeof reason === 'string' ? reason : null
}

export type OutcomeInput = { parsed: unknown; content: string; finishReason: string | null } | { error: unknown }

export function classifyOutcome(input: OutcomeInput): LlmCallOutcome {
  if ('error' in input) return 'error'
  if (input.finishReason === 'length') return 'truncated'
  if (input.parsed != null) return 'ok'
  return input.content.trim() !== '' ? 'parse_failure' : 'empty'
}

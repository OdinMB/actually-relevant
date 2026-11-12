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
  /** Billed output tokens, reasoning included. */
  output: number
  /** Reasoning tokens (subset of `output`). */
  reasoning: number
}

export const ZERO_USAGE: LlmTokenUsage = { input: 0, cached: 0, output: 0, reasoning: 0 }

export function usageFrom(message: AIMessage): LlmTokenUsage {
  const u = message.usage_metadata
  return {
    input: u?.input_tokens ?? 0,
    cached: u?.input_token_details?.cache_read ?? 0,
    output: u?.output_tokens ?? 0,
    reasoning: u?.output_token_details?.reasoning ?? 0,
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

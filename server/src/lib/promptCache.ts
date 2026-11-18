/**
 * OpenAI's prompt cache as every model call asks for it (`.context/prompting.md`, "Prompt caching";
 * ADR-0069): which model ids take the cache controls, the request option that keeps caching off
 * unless a prompt places a breakpoint, a prompt split into its stable part and its per-call data,
 * and the user message that carries the split. Pure.
 *
 * OpenAI caches by default (implicit mode, a breakpoint at the end of the last message), so every
 * call would be written to the cache, at 1.25 times the input price on GPT-5.6 and later, and none
 * read back: each prompt ends in its own data. Explicit mode with no breakpoint turns caching off; a
 * prompt whose builder states `Cache: on` places one breakpoint after its stable part.
 */
import { HumanMessage } from '@langchain/core/messages'

/**
 * A prompt split at its cache breakpoint: `stable` is byte for byte the same on every call of a run
 * (rules, examples, the task, and blocks fixed for the run), `data` is the call's own. The prompt as a
 * reader or a test sees it is `stable + data` (`promptText`).
 */
export interface PromptParts {
  stable: string
  data: string
}

/** A prompt as a step sends it: a plain string, never cached, or split for the cache. */
export type Prompt = string | PromptParts

/** The whole prompt text, as the model reads it. */
export const promptText = (prompt: Prompt): string => (typeof prompt === 'string' ? prompt : prompt.stable + prompt.data)

/**
 * Splits a prompt whose stable part and data are written as two blocks of text, joined by a blank
 * line: the full text is `${stable}\n\n${data}`, the same string the builder returned before it was
 * split.
 */
export const promptParts = (stable: string, data: string): PromptParts => ({ stable: `${stable}\n\n`, data })

/**
 * GPT-5.6 and later, and GPT-6 with its point releases and snapshots: the ids OpenAI documents
 * `prompt_cache_options` and explicit breakpoints for. Any other id, older or unknown, gets neither,
 * since a model that does not take them may reject the request.
 */
const CACHE_CONTROL_MODELS = /^gpt-(?:5\.(?:[6-9]|[1-9]\d)|6)(?:[.-]|$)/

export function takesCacheControls(model: string): boolean {
  return CACHE_CONTROL_MODELS.test(model)
}

/** Explicit mode: nothing is cached or written but at a prompt's own breakpoint. */
export const CACHE_OFF_UNLESS_MARKED = { mode: 'explicit' } as const

/** The request option a client for `model` sends: explicit mode where the model takes it, else none (OpenAI's default). */
export function promptCacheOptions(model: string): typeof CACHE_OFF_UNLESS_MARKED | undefined {
  return takesCacheControls(model) ? CACHE_OFF_UNLESS_MARKED : undefined
}

/**
 * The one user message a call sends. A split prompt goes as two text blocks, the first carrying an
 * explicit breakpoint, to a model that takes the controls; as its whole text otherwise, as a plain
 * prompt always does.
 */
export function promptMessage(prompt: Prompt, model: string): HumanMessage {
  if (typeof prompt === 'string' || !takesCacheControls(model)) return new HumanMessage(promptText(prompt))
  return new HumanMessage({
    content: [
      { type: 'text', text: prompt.stable, prompt_cache_breakpoint: { mode: 'explicit' } },
      { type: 'text', text: prompt.data },
    ],
  })
}

/**
 * What a call's prompt is, as a cache of answers keys it: the text, and for a split prompt sent with
 * its breakpoint, the split, since the two requests differ. The eval's answer cache reads it.
 */
export function promptKey(prompt: Prompt, model: string): string {
  if (typeof prompt === 'string' || !takesCacheControls(model)) return promptText(prompt)
  return `${prompt.stable}\n<<prompt-cache-breakpoint>>\n${prompt.data}`
}

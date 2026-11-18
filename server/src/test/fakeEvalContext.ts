/**
 * An eval context for unit tests of the overview evals: each call is answered by `answer(schemaName,
 * prompt)` (null makes it a parse failure), recorded, and costs `costUsd`; the ledger part says
 * which planned calls the cache answers and what the folder has spent.
 */
import { promptText, type Prompt } from '../lib/promptCache.js'
import type { BudgetedContext } from '../scripts/eval/overviews/factCheck.js'
import type { Arm, CallRecord, PlannedCall } from '../scripts/eval/types.js'

export interface FakeCall {
  arm: Arm
  schemaName: string
  /** The whole prompt text (a cached prompt's stable part and data joined). */
  prompt: string
  /** The prompt as sent: a cached prompt keeps its split. */
  sent: Prompt
}

export interface FakeLedger {
  cached?: (call: PlannedCall) => boolean
  spentUsd?: number
  costUsd?: number
}

export function fakeEvalContext(answer: (schemaName: string, prompt: string) => unknown, ledger: FakeLedger = {}): BudgetedContext & { calls: FakeCall[] } {
  const calls: FakeCall[] = []
  return {
    calls,
    isCached: ledger.cached ?? (() => false),
    spentUsd: () => ledger.spentUsd ?? 0,
    async call<T>(a: Arm, schemaName: string, _schema: unknown, sent: Prompt): Promise<CallRecord<T>> {
      const prompt = promptText(sent)
      calls.push({ arm: a, schemaName, prompt, sent })
      const parsed = answer(schemaName, prompt)
      return {
        key: String(calls.length),
        arm: `${a.model}@${a.effort}`,
        schema: schemaName,
        outcome: parsed === null ? 'parse_failure' : 'ok',
        parsed: parsed as T | null,
        content: '',
        finishReason: 'stop',
        usage: { input: 1000, cached: 0, output: 500, reasoning: 0 },
        costUsd: ledger.costUsd ?? 0,
        latencyMs: 0,
        at: '',
      }
    },
  }
}

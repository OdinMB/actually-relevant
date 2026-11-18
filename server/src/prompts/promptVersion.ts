/**
 * A model step's prompt version: a short hash of its prompt on a fixed input and of its output
 * schema, computed at load, so a changed template or `.describe()` changes the version with no
 * hand-kept number (story context's `CONTEXT_PROMPT_VERSIONS`, a research pass's `PASS_PROMPT_VERSIONS`).
 */
import { createHash } from 'node:crypto'
import { toJsonSchema } from '@langchain/core/utils/json_schema'
import type { z } from 'zod'

export const promptVersionOf = (prompt: string, schema: z.ZodType): string =>
  createHash('sha256')
    .update(prompt)
    .update(JSON.stringify(toJsonSchema(schema)))
    .digest('hex')
    .slice(0, 8)

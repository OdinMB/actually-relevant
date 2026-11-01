import type { FeedChangesetReport } from '@shared/types'
import { ApiError } from '../../lib/admin-api'

/**
 * Reading the server's refusals of a feed changeset: a file that is not a changeset at all (the
 * 400 of `validateBody`, with Zod's flattened details), and an apply refused because a change has
 * an error (a 400 whose body is the preview).
 */

interface FlattenedDetails {
  formErrors?: string[]
  fieldErrors?: Record<string, string[] | undefined>
}

function isDetails(value: unknown): value is FlattenedDetails {
  return typeof value === 'object' && value !== null && ('fieldErrors' in value || 'formErrors' in value)
}

/** The error to show for a failed preview or apply, with what is wrong in the file when the server said. */
export function refusalMessage(err: unknown): string {
  if (!(err instanceof Error)) return 'The changes could not be checked'
  const details = err instanceof ApiError ? (err.body as { details?: unknown } | undefined)?.details : undefined
  if (!isDetails(details)) return err.message
  const problems = [
    ...(details.formErrors ?? []),
    ...Object.entries(details.fieldErrors ?? {}).flatMap(([field, messages]) => (messages ?? []).map(message => `${field}: ${message}`)),
  ]
  return problems.length > 0 ? `This file is not a feed changeset. ${problems.join('; ')}` : err.message
}

/** The preview a refused apply answered with, so the panel can show which change failed; else null. */
export function reportFromRefusal(err: unknown): FeedChangesetReport | null {
  if (!(err instanceof ApiError)) return null
  const body = err.body as Partial<FeedChangesetReport> | undefined
  return body && Array.isArray(body.results) && body.counts ? (body as FeedChangesetReport) : null
}

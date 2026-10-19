/**
 * How a thrown error becomes a response (.context/server-conventions.md, "Route errors"). Services
 * throw a ServiceError (utils/errors.ts) for every refusal a route answers with a 4xx; routes do
 * not catch, but name their 500 text and their Prisma not-found and duplicate texts with
 * failsWith(); errorHandler, registered last in app.ts, answers.
 */
import type { ErrorRequestHandler, RequestHandler, Response } from 'express'
import { createLogger } from '../lib/logger.js'
import { ServiceError } from '../utils/errors.js'

const log = createLogger('http')

/** What one route answers when its handler throws something other than a ServiceError. */
export interface RouteErrorText {
  /** The 500 body's `error`, e.g. "Failed to fetch stories". */
  failure: string
  /** The 404 body's `error` when Prisma finds no row to change (P2025). Default "Not found". */
  notFound?: string
  /** The 409 body's `error` when a unique constraint refuses the write (P2002). Default "Already exists". */
  duplicate?: string
}

/**
 * Names the answers errorHandler gives for this route, so the route needs no catch of its own.
 * Put it first in the route's middleware:
 *
 *   router.put('/:id', failsWith('Failed to update feed', { notFound: 'Feed not found' }), validateBody(…), handler)
 *
 * A ServiceError carries its own status and body and ignores these.
 */
export function failsWith(failure: string, text: Omit<RouteErrorText, 'failure'> = {}): RequestHandler {
  return (_req, res, next) => {
    res.locals.routeErrors = { failure, ...text } satisfies RouteErrorText
    next()
  }
}

function routeErrorText(res: Response): RouteErrorText | undefined {
  return res.locals.routeErrors as RouteErrorText | undefined
}

/** A Prisma known-request error's code (P2025 no row, P2002 unique violation), else undefined. */
function prismaErrorCode(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null)?.code
  return typeof code === 'string' && /^P\d{4}$/.test(code) ? code : undefined
}

/**
 * The global error handler: a ServiceError answers with its own status and body (not logged; the
 * request log line records the 4xx); Prisma's P2025 and P2002 become 404 and 409 with the route's
 * failsWith() text; anything else is logged and answered 500 with the route's failure text.
 */
export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, next) => {
  // A response already under way (a streamed download) cannot change its status
  if (res.headersSent) {
    next(err)
    return
  }

  if (err instanceof ServiceError) {
    res.status(err.status).json(err.toBody())
    return
  }

  const text = routeErrorText(res)
  const prismaCode = prismaErrorCode(err)
  if (prismaCode === 'P2025') {
    res.status(404).json({ error: text?.notFound ?? 'Not found' })
    return
  }
  if (prismaCode === 'P2002') {
    res.status(409).json({ error: text?.duplicate ?? 'Already exists' })
    return
  }

  log.error({ err, method: req.method, url: req.originalUrl, requestId: req.id }, text ? text.failure.toLowerCase() : 'unhandled error')
  res.status(500).json({ error: text?.failure ?? 'Internal server error' })
}

import { createLogger, logger } from './logger.js'
import { notify } from './notify.js'
import type { NoticeInput } from '../services/adminNotices.js'

const log = createLogger('process')

/** How long a crash waits for its admin notice (the database may be the cause) before exiting. */
export const FATAL_NOTICE_WAIT_MS = 3000
/** How long a crash waits for the log transports to flush before exiting. */
const FLUSH_WAIT_MS = 1000

export type FatalKind = 'unhandledRejection' | 'uncaughtException'

let handling = false

/** Resolve when `promise` settles or after `ms`, whichever comes first; never rejects. */
function settleWithin(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, ms)
    timer.unref?.()
    promise.then(
      () => resolve(),
      () => resolve(),
    )
  })
}

/**
 * The admin notice for a crash. It names the kind and the error's type and code, never the
 * message: an arbitrary error's text can quote personal data (.context/admin-notices.md). The
 * stack trace is in the log line written just before.
 */
export function crashNotice(kind: FatalKind, reason: unknown): NoticeInput {
  const type = reason instanceof Error ? reason.name : typeof reason
  const code = reason instanceof Error && 'code' in reason && reason.code ? ` (${String(reason.code)})` : ''
  return {
    source: 'jobs',
    severity: 'critical',
    title: 'Server process crashed',
    message: `${kind}: ${type}${code}. The process exited and Render restarts it; the stack trace is in the server log (module "process").`,
    link: '/admin/jobs',
    dedupeKey: 'process-crash',
  }
}

/**
 * A fatal process error: log it through pino, record an admin notice (best effort, bounded wait),
 * flush the logs and exit with 1, so Render restarts the instance. The crash behavior is Node's
 * own (exit non-zero); what changes is the structured log line and the notice. A second fatal
 * error while the first is handled exits at once.
 */
export async function handleFatal(kind: FatalKind, reason: unknown): Promise<void> {
  if (handling) {
    log.fatal({ err: reason, kind }, 'second fatal error while handling the first, exiting now')
    process.exit(1)
    return
  }
  handling = true

  log.fatal({ err: reason, kind }, 'fatal process error, exiting')
  await settleWithin(
    Promise.resolve().then(() => notify(crashNotice(kind, reason))),
    FATAL_NOTICE_WAIT_MS,
  )
  await settleWithin(new Promise<void>(resolve => logger.flush(() => resolve())), FLUSH_WAIT_MS)
  process.exit(1)
}

/** Register the process-level handlers (called once, from index.ts). */
export function installProcessErrorHandlers(): void {
  process.on('unhandledRejection', reason => void handleFatal('unhandledRejection', reason))
  process.on('uncaughtException', err => void handleFatal('uncaughtException', err))
}

/** Reset the re-entrancy guard (for testing only). */
export function _resetFatalState(): void {
  handling = false
}

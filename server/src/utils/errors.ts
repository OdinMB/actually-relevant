/**
 * A refusal a service raises on purpose: the request cannot be done, and the status says why.
 * Routes do not catch it; the global error handler in app.ts answers with `status` and
 * `toBody()` (`{ error: message }` unless a subclass adds fields). Throw a subclass, never a
 * bare Error, for any failure a route must answer with a 4xx, so that rewording the message
 * can never turn it into a 500 (.context/server-conventions.md, "Route errors").
 */
export class ServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = new.target.name
  }

  /** The JSON body the global error handler answers with. */
  toBody(): Record<string, unknown> {
    return { error: this.message }
  }
}

/** 400: the request names something invalid (a referenced row that does not exist, a value a rule forbids). */
export class BadRequestError extends ServiceError {
  constructor(message: string) {
    super(message, 400)
  }
}

/** 401: the credentials or token presented were rejected. */
export class UnauthorizedError extends ServiceError {
  constructor(message: string) {
    super(message, 401)
  }
}

/** 404: the resource the request is about does not exist. */
export class NotFoundError extends ServiceError {
  constructor(message: string) {
    super(message, 404)
  }
}

/** 409: the resource's current state does not allow the change (already done, in use, in progress). */
export class ConflictError extends ServiceError {
  constructor(message: string) {
    super(message, 409)
  }
}

/** 422: well-formed, but the content breaks a rule. */
export class UnprocessableError extends ServiceError {
  constructor(message: string) {
    super(message, 422)
  }
}

/** True for Prisma's unique-constraint refusal (P2002), e.g. a row a concurrent writer inserted first. */
export function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === 'P2002'
}

/** Produce a short, human-readable error summary without serializing bulky internals. */
export function summarizeError(err: unknown): string {
  if (err instanceof Error && 'isAxiosError' in err) {
    const axiosErr = err as { response?: { status?: number }; code?: string; message: string }
    if (axiosErr.response?.status) return `HTTP ${axiosErr.response.status}`
    if (axiosErr.code) return axiosErr.code
    return axiosErr.message
  }
  return err instanceof Error ? err.message : String(err)
}

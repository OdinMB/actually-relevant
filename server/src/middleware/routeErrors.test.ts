import { describe, it, expect, vi } from 'vitest'
import 'express-async-errors'
import express from 'express'
import request from 'supertest'

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}))

const { errorHandler, failsWith } = await import('./routeErrors.js')
const { BadRequestError, ConflictError, NotFoundError, ServiceError, UnauthorizedError, UnprocessableError } = await import('../utils/errors.js')

class WithDetails extends UnprocessableError {
  override toBody() {
    return { error: this.message, errors: ['a', 'b'] }
  }
}

/** One route that throws `err`, with or without failsWith texts, behind the global handler. */
function appThrowing(err: unknown, texts?: Parameters<typeof failsWith>) {
  const app = express()
  const handler = async () => { throw err }
  if (texts) app.get('/x', failsWith(...texts), handler)
  else app.get('/x', handler)
  app.use(errorHandler)
  return app
}

const prismaError = (code: string) => Object.assign(new Error(`prisma ${code}`), { code })

describe('errorHandler', () => {
  it.each([
    [new BadRequestError('No stories selected'), 400],
    [new UnauthorizedError('Current password is incorrect'), 401],
    [new NotFoundError('Story not found'), 404],
    [new ConflictError('URL already crawled'), 409],
    [new UnprocessableError('too few'), 422],
  ])('answers a ServiceError with its status and message: %s', async (err, status) => {
    const res = await request(appThrowing(err, ['Failed to do it'])).get('/x')
    expect(res.status).toBe(status)
    expect(res.body).toEqual({ error: (err as Error).message })
  })

  it('answers with the body a ServiceError subclass adds', async () => {
    const res = await request(appThrowing(new WithDetails('rejected'))).get('/x')
    expect(res.status).toBe(422)
    expect(res.body).toEqual({ error: 'rejected', errors: ['a', 'b'] })
  })

  it('maps Prisma P2025 to 404 with the route text, or "Not found"', async () => {
    let res = await request(appThrowing(prismaError('P2025'), ['Failed to update feed', { notFound: 'Feed not found' }])).get('/x')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Feed not found' })

    res = await request(appThrowing(prismaError('P2025'))).get('/x')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Not found' })
  })

  it('maps Prisma P2002 to 409 with the route text, or "Already exists"', async () => {
    let res = await request(appThrowing(prismaError('P2002'), ['Failed to create feed', { duplicate: 'A feed with this RSS URL already exists' }])).get('/x')
    expect(res.status).toBe(409)
    expect(res.body).toEqual({ error: 'A feed with this RSS URL already exists' })

    res = await request(appThrowing(prismaError('P2002'))).get('/x')
    expect(res.status).toBe(409)
    expect(res.body).toEqual({ error: 'Already exists' })
  })

  it('answers anything else 500 with the route failure text, or "Internal server error"', async () => {
    let res = await request(appThrowing(new Error('db down'), ['Failed to fetch stories'])).get('/x')
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'Failed to fetch stories' })

    res = await request(appThrowing(new Error('db down'))).get('/x')
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'Internal server error' })
  })

  it('never answers by message: a plain Error saying "Story not found" is a 500', async () => {
    const res = await request(appThrowing(new Error('Story not found'), ['Failed to fetch story'])).get('/x')
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'Failed to fetch story' })
  })

  it('leaves a response already under way to Express, which closes the connection', async () => {
    const app = express()
    const reached = vi.fn()
    app.get('/x', (_req, res) => {
      res.status(200).write('partial')
      throw new ServiceError('late', 400)
    })
    app.use(errorHandler)
    app.use((_err: unknown, _req: unknown, _res: unknown, next: (e?: unknown) => void) => { reached(); next(_err) })
    await expect(request(app).get('/x')).rejects.toThrow()
    expect(reached).toHaveBeenCalled()
  })
})

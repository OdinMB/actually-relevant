import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'express-async-errors'
import express from 'express'
import request from 'supertest'

// Any database read fails the test: while either gate is closed, nothing is read
const mockPrisma = vi.hoisted(
  () =>
    new Proxy(
      {},
      {
        get: (_target, model) => {
          throw new Error(`read prisma.${String(model)} while overviews are switched off`)
        },
      },
    ),
)
vi.mock('../../lib/prisma.js', () => ({ default: mockPrisma }))

const gates = vi.hoisted(() => ({ overview: 'Closed until the eval passes' as string | null }))
vi.mock('../../services/overviewGate.js', () => ({
  get OVERVIEW_EVAL_GATE() {
    return gates.overview
  },
}))

const { default: overviewsRouter } = await import('./overviews.js')
const { errorHandler } = await import('../../middleware/routeErrors.js')

const app = express().use('/api/overviews', overviewsRouter).use(errorHandler)

beforeEach(() => {
  gates.overview = 'Closed until the eval passes'
})

describe('GET /api/overviews while overviews are switched off', () => {
  it('lists none and says the module is off, without reading the database', async () => {
    const res = await request(app).get('/api/overviews')
    expect(res.status).toBe(200)
    expect(res.headers['cache-control']).toBe('public, max-age=300')
    expect(res.body).toEqual({ on: false, overviews: [] })
  })

  it('answers 404 for any slug, without reading the database', async () => {
    const res = await request(app).get('/api/overviews/ebola-in-ituri')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Ongoing story not found' })
  })

  it('reads nothing while only the research passes gate is closed', async () => {
    gates.overview = null
    const [list, page] = await Promise.all([request(app).get('/api/overviews'), request(app).get('/api/overviews/ebola-in-ituri')])
    expect(list.body).toEqual({ on: false, overviews: [] })
    expect(page.status).toBe(404)
  })
})

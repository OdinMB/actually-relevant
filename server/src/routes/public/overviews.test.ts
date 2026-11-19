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

// Both gates held here, so these tests keep their meaning once either constant is opened
const gates = vi.hoisted(() => ({ overview: 'Closed until the eval passes' as string | null, pass: 'Closed until the eval passes' as string | null }))
vi.mock('../../services/overviewGate.js', () => ({
  get OVERVIEW_EVAL_GATE() {
    return gates.overview
  },
}))
vi.mock('../../services/researchPassGate.js', () => ({
  get PASS_EVAL_GATE() {
    return gates.pass
  },
}))

const { default: overviewsRouter } = await import('./overviews.js')
const { errorHandler } = await import('../../middleware/routeErrors.js')
const { clearPublicCaches } = await import('../../lib/publicCaches.js')

const app = express().use('/api/overviews', overviewsRouter).use(errorHandler)

beforeEach(() => {
  gates.overview = 'Closed until the eval passes'
  gates.pass = 'Closed until the eval passes'
  // The list is kept in memory: each test asks afresh
  clearPublicCaches()
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

  it('answers the layout’s on-only question (`limit=0`) the same way, and refuses a limit that is no whole number from 0', async () => {
    const on = await request(app).get('/api/overviews?limit=0')
    expect(on.status).toBe(200)
    expect(on.body).toEqual({ on: false, overviews: [] })
    for (const bad of ['-1', 'two', '1.5']) expect((await request(app).get(`/api/overviews?limit=${bad}`)).status, bad).toBe(400)
  })

  it('reads nothing while only the research passes gate is closed', async () => {
    gates.overview = null
    const [list, page] = await Promise.all([request(app).get('/api/overviews'), request(app).get('/api/overviews/ebola-in-ituri')])
    expect(list.body).toEqual({ on: false, overviews: [] })
    expect(page.status).toBe(404)
  })

  it('reads the job row once both gates are open', async () => {
    gates.overview = null
    gates.pass = null
    // The proxy throws on the first read, so the route answers 500: the read was tried
    expect((await request(app).get('/api/overviews')).status).toBe(500)
  })
})

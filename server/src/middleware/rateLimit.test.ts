import { describe, it, expect, afterAll } from 'vitest'
import express from 'express'
import request from 'supertest'
import { apiLimiter, expensiveOpLimiter, authLimiter, refreshLimiter } from './rateLimit.js'
import { config } from '../config.js'

describe('Rate Limiters', () => {
  it('exports apiLimiter', () => {
    expect(apiLimiter).toBeDefined()
    expect(typeof apiLimiter).toBe('function')
  })

  it('exports expensiveOpLimiter', () => {
    expect(expensiveOpLimiter).toBeDefined()
    expect(typeof expensiveOpLimiter).toBe('function')
  })

  it('exports authLimiter', () => {
    expect(authLimiter).toBeDefined()
    expect(typeof authLimiter).toBe('function')
  })

  it('exports refreshLimiter', () => {
    expect(refreshLimiter).toBeDefined()
    expect(typeof refreshLimiter).toBe('function')
  })

  it('defaults the keyed limit to ten times the per-IP limit', () => {
    expect(config.rateLimit.publicApiKeyMax).toBe(config.rateLimit.publicMax * 10)
  })
})

describe('apiLimiter and PUBLIC_API_KEY', () => {
  const original = { publicMax: config.rateLimit.publicMax, publicApiKeyMax: config.rateLimit.publicApiKeyMax, key: process.env.PUBLIC_API_KEY }

  afterAll(() => {
    config.rateLimit.publicMax = original.publicMax
    config.rateLimit.publicApiKeyMax = original.publicApiKeyMax
    if (original.key !== undefined) process.env.PUBLIC_API_KEY = original.key
    else delete process.env.PUBLIC_API_KEY
  })

  it('gives a request with the valid key its own larger budget; a wrong key counts as no key', async () => {
    // One limiter instance (and store) for the whole sequence, as in production
    config.rateLimit.publicMax = 2
    config.rateLimit.publicApiKeyMax = 4
    process.env.PUBLIC_API_KEY = 'partner-key-123'
    const app = express()
    app.use(apiLimiter)
    app.get('/x', (_req, res) => {
      res.json({ ok: true })
    })

    const anonymous = () => request(app).get('/x')
    const keyed = () => request(app).get('/x').set('Authorization', 'Bearer partner-key-123')
    const wrongKey = () => request(app).get('/x').set('Authorization', 'Bearer not-the-key')

    // Without a key: the per-IP limit, as before
    expect((await anonymous()).status).toBe(200)
    const second = await anonymous()
    expect(second.status).toBe(200)
    expect(second.headers['ratelimit-limit']).toBe('2')
    expect((await anonymous()).status).toBe(429)

    // A wrong key is an ordinary request: same IP bucket, already spent
    expect((await wrongKey()).status).toBe(429)

    // The valid key: its own budget, not the spent IP bucket
    for (let i = 0; i < 4; i++) {
      const res = await keyed()
      expect(res.status).toBe(200)
      expect(res.headers['ratelimit-limit']).toBe('4')
    }
    expect((await keyed()).status).toBe(429)
  })
})

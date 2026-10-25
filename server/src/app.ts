import 'dotenv/config'
import 'express-async-errors'
import express from 'express'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import helmet from 'helmet'
import { randomUUID } from 'crypto'
import type { Request, Response } from 'express'
import { createLogger } from './lib/logger.js'
import { config } from './config.js'
import { errorHandler } from './middleware/routeErrors.js'
import healthRouter from './routes/health.js'
import authRouter from './routes/auth.js'
import adminRouter from './routes/admin/index.js'
import publicRouter from './routes/public/index.js'

const httpLog = createLogger('http')

const app = express()

// Requests pass Cloudflare and then Render's proxies; trust exactly that many hops
// so req.ip (and every rate limit) keys on the visitor. The count is TRUST_PROXY,
// verified with GET /health/client-ip — see .context/deployment.md.
app.set('trust proxy', config.trustProxyHops)

// Security headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
)

// CORS configuration.
// Dev ports 5173-5180 (Vite increments when a port is taken) and preview ports
// 4173-4174, on both localhost and 127.0.0.1.
const devPorts = [5173, 5174, 5175, 5176, 5177, 5178, 5179, 5180, 4173, 4174]
const allowedOrigins = [...devPorts.flatMap(port => [`http://localhost:${port}`, `http://127.0.0.1:${port}`]), config.frontendUrl].filter(
  Boolean,
) as string[]

// Open CORS for public read-only endpoints (widget/embed API calls from any origin).
// /api/subscribe/token is included: it's an anonymous, side-effect-free GET the
// public signup form must fetch on render (the state-changing POSTs stay restricted below).
const publicReadPaths = ['/api/stories', '/api/issues', '/api/homepage', '/api/feed', '/api/docs', '/api/subscribe/token', '/api/podcast', '/api/newsletters']
// A path or one of its sub-paths, never a mere string prefix (/api/feed must not open /api/feedback).
const isPublicReadPath = (path: string) => publicReadPaths.some(p => path === p || path.startsWith(p + '/'))
app.use((req, res, next) => {
  if (isPublicReadPath(req.path)) {
    res.set('Access-Control-Allow-Origin', '*')
    res.set('Access-Control-Allow-Methods', 'GET')
    res.set('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') return res.sendStatus(204)
    return next()
  }
  // Restricted CORS for everything else (auth, admin, subscribe)
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true)
      if (allowedOrigins.includes(origin)) {
        return callback(null, true)
      }
      return callback(new Error('Not allowed by CORS'))
    },
    credentials: true,
  })(req, res, next)
})

app.use(express.json({ limit: '100kb' }))
app.use(cookieParser())

// Request ID: inherit a well-formed one from the header (a proxy's trace id), else generate. The
// value is echoed in a response header and written to logs, so anything else is replaced.
const REQUEST_ID_RE = /^[A-Za-z0-9._-]{1,64}$/
export function requestIdFrom(header: string | string[] | undefined): string {
  return typeof header === 'string' && REQUEST_ID_RE.test(header) ? header : randomUUID()
}
app.use((req, res, next) => {
  req.id = requestIdFrom(req.headers['x-request-id'])
  res.set('X-Request-Id', req.id)
  next()
})

// Request logging — single line per request, no redundant fields
app.use((req, res, next) => {
  if (req.originalUrl === '/health') return next()
  const start = Date.now()
  res.on('finish', () => {
    const ms = Date.now() - start
    const status = res.statusCode
    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info'
    httpLog[level]({ requestId: req.id }, `${req.method} ${req.originalUrl} ${status} ${ms}ms`)
  })
  next()
})

// Routes
app.use('/health', healthRouter)
app.use('/api/auth', authRouter)
app.use('/api/admin', adminRouter)
app.use('/api', publicRouter)

// 404 handler for unmatched routes
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' })
})

// Global error handler — must be last middleware. The one place a thrown error becomes a response
// (middleware/routeErrors.ts; .context/server-conventions.md, "Route errors").
app.use(errorHandler)

export default app

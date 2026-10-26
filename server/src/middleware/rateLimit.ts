import rateLimit from 'express-rate-limit'
import { config } from '../config.js'
import { hasValidPublicApiKey } from './auth.js'

/** The bucket every request carrying the valid PUBLIC_API_KEY shares, whatever its IP. */
export const PUBLIC_API_KEY_BUCKET = 'public-api-key'

/**
 * General API rate limiter, applied to the public endpoints to prevent abuse:
 * `config.rateLimit.publicMax` requests per window and client IP. A request carrying the valid
 * PUBLIC_API_KEY (`Authorization: Bearer <key>`) counts against the key's own, larger budget
 * instead (`publicApiKeyMax`, one bucket for the key, so a leaked key is still capped). A wrong or
 * missing key is an ordinary request, never an error.
 */
export const apiLimiter = rateLimit({
  windowMs: config.rateLimit.publicWindowMs,
  max: req => (hasValidPublicApiKey(req) ? config.rateLimit.publicApiKeyMax : config.rateLimit.publicMax),
  keyGenerator: req => (hasValidPublicApiKey(req) ? PUBLIC_API_KEY_BUCKET : (req.ip ?? '')),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests. Please try again later.',
  },
})

/**
 * Operational rate limiter for LLM-triggering endpoints.
 * Not a security measure — admins are trusted. This prevents runaway
 * costs by capping the number of LLM operations per hour.
 * Each endpoint tracks its own budget via keyGenerator.
 */
export const expensiveOpLimiter = rateLimit({
  windowMs: config.rateLimit.expensiveWindowMs,
  max: config.rateLimit.expensiveMax,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => `${req.ip}-${req.baseUrl}${req.path}`,
  message: {
    error: 'Operational limit reached for this endpoint. Please try again later.',
  },
})

/**
 * Stricter rate limiter for search queries that trigger OpenAI embedding calls.
 * 20 searches per 15 minutes per IP (vs 100 for general API).
 */
export const searchLimiter = rateLimit({
  windowMs: config.rateLimit.searchWindowMs,
  max: config.rateLimit.searchMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many search requests. Please try again later.',
  },
})

/**
 * Strict rate limiter for login endpoint, per IP, against brute-force attacks
 * (config.rateLimit.loginMax per loginWindowMs).
 */
export const authLimiter = rateLimit({
  windowMs: config.rateLimit.loginWindowMs,
  max: config.rateLimit.loginMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many login attempts. Please try again later.',
  },
})

/**
 * Rate limiter for token refresh endpoint.
 * More lenient than login since refresh is called automatically by the client.
 */
export const refreshLimiter = rateLimit({
  windowMs: config.rateLimit.refreshWindowMs,
  max: config.rateLimit.refreshMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many refresh attempts. Please try again later.',
  },
})

import type { Request, RequestHandler } from 'express'
import { config } from '../config.js'
import { sendAnalyticsEvent } from '../lib/simpleAnalytics.js'
import { ownSiteHosts, usageEvent, type UsageRequest } from '../lib/usageEvents.js'

/** The facts counting needs, read when the request arrives: the routers rewrite `req.url`, and so `req.path`, on the way down. */
function arrivalFacts(req: Request): Omit<UsageRequest, 'status'> {
  return {
    method: req.method,
    path: req.path,
    origin: req.get('origin'),
    referer: req.get('referer'),
    fromWidget: req.query.ref === 'widget',
    issueSlug: typeof req.query.issueSlug === 'string' ? req.query.issueSlug : undefined,
    doNotTrack: req.get('dnt') === '1' || req.get('sec-gpc') === '1',
  }
}

/**
 * Counts widget loads and outside calls of the public API in Simple Analytics
 * (.context/public-website.md, "Usage counting"). The event goes out after the response has
 * finished and is never awaited, so counting cannot delay or fail a request.
 */
export const countUsage: RequestHandler = (req, res, next) => {
  if (!config.simpleAnalytics.eventsEnabled) return next()
  const facts = arrivalFacts(req)
  res.on('finish', () => {
    const event = usageEvent({ ...facts, status: res.statusCode }, ownSiteHosts([config.frontendUrl, config.siteUrl]))
    if (event) void sendAnalyticsEvent(event)
  })
  next()
}

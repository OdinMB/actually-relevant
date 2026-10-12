import { Router } from 'express'
import { Prisma } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'

/** Operational self-checks of the deployment. */
const router = Router()

router.get('/', async (_req, res) => {
  try {
    await prisma.$queryRaw(Prisma.sql`SELECT 1`)
    res.json({
      status: 'ok',
      database: 'connected',
      uptime: process.uptime(),
    })
  } catch {
    res.status(503).json({ status: 'error', database: 'disconnected' })
  }
})

/**
 * Shows the caller how the server sees their own request, to verify TRUST_PROXY
 * on the live site (see .context/deployment.md). CF-Connecting-IP is the ground
 * truth there, since Cloudflare overwrites any value a visitor sends. Returns only
 * the caller's own address and proxy addresses; stores and logs nothing.
 */
router.get('/client-ip', (req, res) => {
  const cloudflareIp = req.get('CF-Connecting-IP') ?? null
  res.set('Cache-Control', 'no-store')
  res.json({
    ip: req.ip ?? null,
    cloudflareIp,
    forwardedFor: req.get('X-Forwarded-For') ?? null,
    trustProxyHops: config.trustProxyHops,
    matchesCloudflare: cloudflareIp === null ? null : req.ip === cloudflareIp,
  })
})

export default router

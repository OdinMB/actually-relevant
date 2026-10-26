/**
 * Test support, started by test/launcher.test.mjs with the run's cleared environment: makes the
 * network case's Node probe to the URL it is given and prints what it found and the environment's
 * names. Kept out of test/, so a bare `node --test` never runs it; it refuses to run without a URL.
 */
import { probeFromNode } from '../lib/network-probe.mjs'

const url = process.argv[2]
if (!url) {
  process.stderr.write('usage: node support/probe-in-env.mjs <url>\n')
  process.exit(64)
}
const probe = await probeFromNode({ timeoutMs: 5000, url })
process.stdout.write(JSON.stringify({ probe, envNames: Object.keys(process.env) }))

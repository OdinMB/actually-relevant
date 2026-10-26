/**
 * The run's process: started only by the launcher, in the cleared environment. Wires the real
 * fixture API, Vite and Puppeteer into `runHermetic`, stops everything on its own timeout, a
 * signal or an error, writes the outputs, and exits.
 */
import fs from 'node:fs'
import path from 'node:path'
import { driveViewport, launchBrowser, probeFromBrowser } from './browser.mjs'
import { startFixtureServer } from './fixture-api.mjs'
import { EXIT, guardRefusedLine, parseEnvExampleNames } from './guard.mjs'
import { decodeRunSettings } from './launcher.mjs'
import { probeFromNode } from './network-probe.mjs'
import { parseSteps } from './options.mjs'
import { clientDir, importFromClient } from './paths.mjs'
import { createCleanup, createRunRecord, runHermetic, writeOutputs } from './run-child.mjs'
import { prepareSite, startSiteListener } from './site.mjs'

function print(line) {
  process.stdout.write(`${line}\n`)
}

function message(err) {
  return err instanceof Error ? err.message.split('\n')[0] : String(err)
}

export async function childMain(encodedSettings) {
  if (process.env.SITE_HARNESS_CHILD !== '1') {
    print(guardRefusedLine(['the run was started outside its launcher; start it as node harness/site/run.mjs']))
    return EXIT.refused
  }
  let settings
  try {
    settings = decodeRunSettings(encodedSettings)
  } catch (err) {
    print(guardRefusedLine([message(err)]))
    return EXIT.refused
  }
  const { opts, outDir } = settings
  const cleanup = createCleanup()
  const run = createRunRecord({ opts, startedAt: new Date() })

  let finishing = null
  const finish = (code, reason) => {
    finishing ??= (async () => {
      const failed = await cleanup.run()
      if (failed.length > 0) print(`site-harness: could not stop cleanly: ${failed.join(', ')}`)
      try {
        writeOutputs(outDir, run, { code, reason, finishedAt: new Date() })
      } catch (err) {
        print(`site-harness: could not write the report: ${message(err)}`)
      }
      await new Promise(resolve => process.stdout.write('', resolve))
      process.exit(code)
    })()
    return finishing
  }

  const timer = setTimeout(() => {
    print(`site-harness: timed out after ${opts.timeoutSec} s; stopping everything`)
    void finish(EXIT.timeout, 'timeout')
  }, opts.timeoutSec * 1000)
  for (const signal of process.platform === 'win32' ? ['SIGINT', 'SIGTERM', 'SIGBREAK'] : ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      print(`site-harness: ${signal}; stopping everything`)
      void finish(EXIT.interrupted, signal)
    })
  }
  process.on('uncaughtException', err => {
    print(`site-harness: failed: ${message(err)}`)
    void finish(EXIT.failed, 'error')
  })
  // A stray rejection (a request the page dropped while a context closed) is noted, not fatal
  process.on('unhandledRejection', err => print(`site-harness: note: an unhandled rejection: ${message(err)}`))

  try {
    const steps = opts.stepsFile ? parseSteps(JSON.parse(fs.readFileSync(opts.stepsFile, 'utf8'))) : []
    const vite = await importFromClient('vite')
    const puppeteer = (await importFromClient('puppeteer')).default
    const deps = {
      startFixtureServer,
      startSiteListener,
      prepareSite: args => prepareSite(vite, { clientDir, ...args }),
      launchBrowser: args => launchBrowser(puppeteer, { ...args, protocolTimeoutMs: Math.max(60_000, opts.stepTimeoutSec * 2000) }),
      driveViewport,
      probeFromBrowser,
      probeFromNode,
      now: () => new Date(),
      envExampleNames: parseEnvExampleNames(fs.readFileSync(path.join(clientDir, 'env.example'), 'utf8')),
      indexHtml: fs.readFileSync(path.join(clientDir, 'index.html'), 'utf8'),
    }
    const runtime = { version: process.version, features: process.features, allowedNodeEnvironmentFlags: process.allowedNodeEnvironmentFlags }
    const code = await runHermetic({ opts, steps, internal: settings, env: process.env, platform: process.platform, runtime, deps, print, cleanup, run })
    clearTimeout(timer)
    await finish(code, code === EXIT.ok ? 'ok' : code === EXIT.refused ? 'refused' : 'failed')
  } catch (err) {
    print(`site-harness: failed: ${message(err)}`)
    await finish(EXIT.failed, 'error')
  }
  return EXIT.failed
}

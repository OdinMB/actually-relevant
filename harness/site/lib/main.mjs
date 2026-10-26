/**
 * Dispatches the entry point: the launcher by default, the run itself when the launcher started
 * it. The run's modules (fixtures, Vite, Puppeteer) load only in the run, after the launcher has
 * checked this Node can load them.
 */
import { CHILD_FLAG, launch } from './launcher.mjs'

export async function main(argv) {
  if (argv[0] === CHILD_FLAG) {
    const { childMain } = await import('./child.mjs')
    return childMain(argv[1])
  }
  return launch(argv, {
    parentEnv: process.env,
    platform: process.platform,
    runtime: { version: process.version, features: process.features, allowedNodeEnvironmentFlags: process.allowedNodeEnvironmentFlags },
    print: line => process.stdout.write(`${line}\n`),
    printError: line => process.stderr.write(`${line}\n`),
  })
}

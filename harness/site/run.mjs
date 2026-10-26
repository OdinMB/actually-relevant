#!/usr/bin/env node
/**
 * The site harness: node harness/site/run.mjs --out <folder> [parameters]. Development tooling,
 * never deployed; README.md documents the parameters, the outputs and the guard.
 */
import { main } from './lib/main.mjs'

const code = await main(process.argv.slice(2))
process.stdout.write('', () => process.exit(code))

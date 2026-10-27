import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { format, resolveConfig } from 'prettier'
import { describeChanges, diffContracts, type Contract } from '../../lib/openapiContract.js'

/**
 * Write `current` to the snapshot at `path`, after listing how it differs from the committed one.
 * A breaking change is written only with `acceptBreaking`; without it nothing is written and the
 * result is false. The file is formatted as Prettier formats JSON there, so `format:check` passes.
 */
export async function refreshApiSnapshot(options: {
  path: string
  current: Contract
  acceptBreaking: boolean
  log?: (line: string) => void
}): Promise<boolean> {
  const { path, current, acceptBreaking, log = console.log } = options
  if (existsSync(path)) {
    const changes = diffContracts(JSON.parse(readFileSync(path, 'utf8')), current)
    if (changes.length > 0) log(describeChanges(changes))
    if (changes.some(change => change.breaking) && !acceptBreaking) {
      log('\nNot written: the change is breaking. Rerun with -- --accept-breaking if the break is intended.')
      return false
    }
    if (changes.length === 0) log(`The contract is unchanged; the snapshot is up to date: ${path}`)
  } else {
    log(`No snapshot yet at ${path}: writing it.`)
  }
  writeFileSync(path, await format(JSON.stringify(current), { ...(await resolveConfig(path)), filepath: path }))
  return true
}

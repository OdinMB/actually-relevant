/**
 * A lock one process holds at a time, kept as files `<base>.lock.<n>` that hold the holder's pid: the
 * highest generation `n` is the lock. A taker that finds the holder alive refuses (`LockHeld`); one
 * that finds it dead takes over by creating the next generation. Each file appears with its pid
 * already in it (written aside, then hard-linked into place, which fails when the name exists), so of
 * two takers past one dead holder only one can create that generation, and no taker ever reads a
 * lock without its pid. A taker that has linked its generation looks once more, and gives way to a
 * live holder of any other one. A pid that a later, unrelated process happens to reuse reads as alive: the
 * taker refuses, never the other way round.
 */
import { randomBytes } from 'node:crypto'
import { linkSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'

export class LockHeld extends Error {
  constructor(
    readonly pid: number,
    file: string,
  ) {
    super(`in use by process ${pid} (${file}; delete that file only if no such process is the one using it)`)
    this.name = 'LockHeld'
  }
}

export interface PidLock {
  release(): void
}

/** Whether a process with this pid runs (one of another user's counts: it cannot be signalled, but it runs). */
export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

const lockFile = (base: string, generation: number) => `${base}.lock.${generation}`

/** The generations on disk, highest first. */
function generations(base: string): number[] {
  const prefix = `${basename(base)}.lock.`
  return readdirSync(dirname(base))
    .filter(name => name.startsWith(prefix) && /^\d+$/.test(name.slice(prefix.length)))
    .map(name => Number(name.slice(prefix.length)))
    .sort((a, b) => b - a)
}

/** The pid a generation's file holds; null once it is gone (released meanwhile). */
function holderOf(file: string): number | null {
  try {
    return Number(readFileSync(file, 'utf8').trim())
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

/** The pid of the live process holding the lock, or null when none does. */
export function lockHolder(base: string, alive: (pid: number) => boolean = pidAlive): number | null {
  for (const g of generations(base)) {
    const pid = holderOf(lockFile(base, g))
    if (pid !== null && alive(pid)) return pid
  }
  return null
}

/** Take the lock for this process, or throw `LockHeld` while a live process holds it. */
export function takePidLock(base: string, alive: (pid: number) => boolean = pidAlive): PidLock {
  // Each pass either takes the lock, refuses, or saw the lock files change under it and looks again
  for (let pass = 0; pass < 20; pass++) {
    const top = generations(base)[0] ?? 0
    if (top > 0) {
      const pid = holderOf(lockFile(base, top))
      if (pid === null) continue
      if (alive(pid)) throw new LockHeld(pid, lockFile(base, top))
    }
    const mine = lockFile(base, top + 1)
    const aside = `${base}.lock-aside-${process.pid}-${randomBytes(4).toString('hex')}`
    writeFileSync(aside, String(process.pid))
    try {
      linkSync(aside, mine)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw err
    } finally {
      rmSync(aside, { force: true })
    }
    // Looked at again once linked: a taker that raced this one (it found no lock file at all, as the
    // last holder released) may hold another generation. A live holder of any other generation makes
    // this one give way, and only dead holders' files are removed, so two takers never both hold the
    // lock; at worst both give way and the command is run again.
    const dead: string[] = []
    for (const g of generations(base)) {
      if (g === top + 1) continue
      const file = lockFile(base, g)
      const pid = holderOf(file)
      if (pid === null) continue
      if (alive(pid)) {
        rmSync(mine, { force: true })
        throw new LockHeld(pid, file)
      }
      dead.push(file)
    }
    for (const file of dead) rmSync(file, { force: true })
    let released = false
    return {
      release() {
        if (released) return
        released = true
        rmSync(mine, { force: true })
      },
    }
  }
  throw new Error(`could not take the lock ${base}.lock.*: its files kept changing`)
}

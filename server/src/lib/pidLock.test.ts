import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LockHeld, lockHolder, pidAlive, takePidLock } from './pidLock.js'

const dirs: string[] = []
const tempBase = () => {
  const dir = mkdtempSync(join(tmpdir(), 'pid-lock-'))
  dirs.push(dir)
  return join(dir, 'task')
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const DEAD = 2_000_000_001
const aliveUnlessDead = (pid: number) => pid !== DEAD

describe('takePidLock', () => {
  it('is held by one taker at a time: a second take refuses, naming the holder, until the first releases', () => {
    const base = tempBase()
    const lock = takePidLock(base)
    expect(lockHolder(base)).toBe(process.pid)
    const second = (() => {
      try {
        takePidLock(base)
        return null
      } catch (err) {
        return err
      }
    })()
    expect(second).toBeInstanceOf(LockHeld)
    expect((second as LockHeld).pid).toBe(process.pid)
    lock.release()
    expect(lockHolder(base)).toBeNull()
    takePidLock(base).release()
  })

  it('takes over a lock whose holder died, and leaves no file of it behind', () => {
    const base = tempBase()
    writeFileSync(`${base}.lock.1`, String(DEAD))
    expect(lockHolder(base, aliveUnlessDead)).toBeNull()
    const lock = takePidLock(base, aliveUnlessDead)
    expect(lockHolder(base, aliveUnlessDead)).toBe(process.pid)
    expect(readdirSync(join(base, '..')).filter(n => n.includes('.lock'))).toEqual(['task.lock.2'])
    lock.release()
    expect(readdirSync(join(base, '..')).filter(n => n.includes('.lock'))).toEqual([])
  })

  it('lets only one of two takers past a dead holder: the second finds the first alive', () => {
    const base = tempBase()
    writeFileSync(`${base}.lock.1`, String(DEAD))
    const first = takePidLock(base, aliveUnlessDead)
    expect(() => takePidLock(base, aliveUnlessDead)).toThrow(LockHeld)
    first.release()
  })

  it('refuses, and removes nothing of it, when a live holder sits below a dead top generation (a taker that raced it)', () => {
    const base = tempBase()
    writeFileSync(`${base}.lock.1`, '4243')
    writeFileSync(`${base}.lock.2`, String(DEAD))
    expect(() => takePidLock(base, aliveUnlessDead)).toThrow(/4243/)
    expect(readdirSync(join(base, '..')).filter(n => n.includes('.lock'))).toEqual(['task.lock.1', 'task.lock.2'])
  })

  it('refuses while a live process other than this one holds it', () => {
    const base = tempBase()
    writeFileSync(`${base}.lock.3`, '4242')
    expect(() => takePidLock(base, () => true)).toThrow(/4242/)
  })
})

describe('pidAlive', () => {
  it('tells a running process from a pid that is not one', () => {
    expect(pidAlive(process.pid)).toBe(true)
    expect(pidAlive(DEAD)).toBe(false)
    expect(pidAlive(Number.NaN)).toBe(false)
  })
})

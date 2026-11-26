import { describe, it, expect, afterEach } from 'vitest'
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  _resetSpendGuard,
  capFile,
  createCap,
  installSpendGuard,
  NO_CAP,
  openCap,
  readCap,
  settledUsd,
  SPEND_CAP_REACHED_CODE,
  SpendCapReached,
  spendGuard,
  spendRefusalOf,
  SpendRefused,
  type TaskCap,
} from './spendCap.js'

const dirs: string[] = []
const opened: TaskCap[] = []
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'spend-cap-'))
  dirs.push(dir)
  return dir
}
const open = (dir: string, name: string, alive?: (pid: number) => boolean) => {
  const cap = openCap(dir, name, alive)
  opened.push(cap)
  return cap
}
afterEach(() => {
  for (const c of opened.splice(0)) c.close()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  _resetSpendGuard()
})

/** Settles once the microtasks queued so far have run: whether a reservation is still waiting. */
const pending = async (p: Promise<unknown>) => {
  let done = false
  void p.then(
    () => (done = true),
    () => (done = true),
  )
  await new Promise(resolve => setTimeout(resolve, 5))
  return !done
}

describe('a task cap', () => {
  it('starts with its whole amount left and nothing open', () => {
    const dir = tempDir()
    createCap(dir, 'task-a', 5)
    expect(readCap(dir, 'task-a')).toMatchObject({ name: 'task-a', capUsd: 5, settledUsd: 0, openUsd: 0, openCount: 0, remainingUsd: 5, inUseBy: null })
  })

  it('can never be raised: creating it again refuses and leaves its amount, and a ledger holding a second amount refuses to load', () => {
    const dir = tempDir()
    createCap(dir, 'task-a', 5)
    expect(() => createCap(dir, 'task-a', 50)).toThrow(/never be raised/)
    expect(readCap(dir, 'task-a').capUsd).toBe(5)
    appendFileSync(capFile(dir, 'task-a'), JSON.stringify({ event: 'created', name: 'task-a', usd: 50, at: '' }) + '\n')
    expect(() => readCap(dir, 'task-a')).toThrow(/second amount/)
    expect(() => openCap(dir, 'task-a')).toThrow(/second amount/)
  })

  it('refuses a name that is no plain file name, and an amount that is not a positive number', () => {
    const dir = tempDir()
    expect(() => createCap(dir, '../escape', 5)).toThrow(/name/)
    expect(() => createCap(dir, 'ok', 0)).toThrow(/amount/)
    expect(() => createCap(dir, 'ok', Number.NaN)).toThrow(/amount/)
  })

  it('holds a reservation until it settles, then counts the real cost', async () => {
    const dir = tempDir()
    createCap(dir, 't', 1)
    const cap = open(dir, 't')
    const r = await cap.reserve(0.4, 'openai gpt-6-luna')
    expect(cap.state()).toMatchObject({ settledUsd: 0, openUsd: 0.4, openCount: 1, remainingUsd: expect.closeTo(0.6, 10) })
    r.settle(0.05)
    expect(cap.state()).toMatchObject({ settledUsd: 0.05, openUsd: 0, openCount: 0, remainingUsd: expect.closeTo(0.95, 10) })
    expect(cap.spentHereUsd()).toBeCloseTo(0.05)
    // A second settle of the same reservation changes nothing
    r.settle(0.4)
    expect(cap.state().settledUsd).toBe(0.05)
    expect(readCap(dir, 't')).toMatchObject({ settledUsd: 0.05, openCount: 0, inUseBy: process.pid })
  })

  it('refuses a reservation that does not fit when nothing of its own is in flight, and writes nothing for it', async () => {
    const dir = tempDir()
    createCap(dir, 't', 1)
    const cap = open(dir, 't')
    const before = readFileSync(capFile(dir, 't'), 'utf8')
    await expect(cap.reserve(1.01, 'openai gpt-6.1-sol')).rejects.toBeInstanceOf(SpendCapReached)
    expect(readFileSync(capFile(dir, 't'), 'utf8')).toBe(before)
  })

  it('waits while a request of its own in flight could make room, and goes on once it settles below its reservation', async () => {
    const dir = tempDir()
    createCap(dir, 't', 1)
    const cap = open(dir, 't')
    const first = await cap.reserve(0.7, 'a')
    const second = cap.reserve(0.5, 'b')
    expect(await pending(second)).toBe(true)
    first.settle(0.1)
    const r = await second
    expect(r.usd).toBe(0.5)
    expect(cap.state()).toMatchObject({ settledUsd: 0.1, openUsd: 0.5 })
  })

  it('refuses a waiting reservation once the requests in flight settled and still left no room', async () => {
    const dir = tempDir()
    createCap(dir, 't', 1)
    const cap = open(dir, 't')
    const first = await cap.reserve(0.7, 'a')
    const second = cap.reserve(0.5, 'b')
    expect(await pending(second)).toBe(true)
    first.settle(0.7)
    await expect(second).rejects.toBeInstanceOf(SpendCapReached)
  })

  it('refuses at once what no release could make room for, even with requests in flight', async () => {
    const dir = tempDir()
    createCap(dir, 't', 1)
    const cap = open(dir, 't')
    await cap.reserve(0.3, 'a')
    await expect(cap.reserve(1.2, 'b')).rejects.toBeInstanceOf(SpendCapReached)
  })

  it('records a real cost above the reservation as it was', async () => {
    const dir = tempDir()
    createCap(dir, 't', 1)
    const cap = open(dir, 't')
    ;(await cap.reserve(0.1, 'a')).settle(0.3)
    expect(cap.state().settledUsd).toBeCloseTo(0.3)
  })

  it('never lets reservations running at once pass the cap together', async () => {
    const dir = tempDir()
    createCap(dir, 't', 1)
    const cap = open(dir, 't')
    let worst = 0
    let refused = 0
    const watch = () => {
      const s = cap.state()
      worst = Math.max(worst, s.settledUsd + s.openUsd)
    }
    // A fixed spread of sizes, waits and real costs, so the run is the same every time
    await Promise.all(
      Array.from({ length: 120 }, async (_, i) => {
        const usd = 0.02 + ((i * 37) % 23) / 100
        try {
          const r = await cap.reserve(usd, `r${i}`)
          watch()
          await new Promise(resolve => setTimeout(resolve, (i * 7) % 5))
          r.settle(usd * (((i * 13) % 10) / 10))
          watch()
        } catch (err) {
          expect(err).toBeInstanceOf(SpendCapReached)
          refused++
        }
      }),
    )
    expect(worst).toBeLessThanOrEqual(1)
    expect(refused).toBeGreaterThan(0)
    expect(cap.state().openCount).toBe(0)
    // Every prefix of the ledger on disk holds the same bound
    const lines = readFileSync(capFile(dir, 't'), 'utf8').trim().split('\n').slice(1)
    const live = new Map<string, number>()
    let settled = 0
    for (const line of lines) {
      const e = JSON.parse(line) as { event: string; id: string; usd: number }
      if (e.event === 'reserved') live.set(e.id, e.usd)
      else {
        live.delete(e.id)
        settled += e.usd
      }
      expect(settled + [...live.values()].reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1)
    }
  })
})

describe('after a crash', () => {
  it('counts a reservation that was never settled at its full amount', async () => {
    const dir = tempDir()
    createCap(dir, 't', 1)
    const cap = openCap(dir, 't')
    await cap.reserve(0.4, 'in flight when the process ended')
    ;(await cap.reserve(0.2, 'answered')).settle(0.05)
    cap.close()
    expect(readCap(dir, 't')).toMatchObject({ settledUsd: 0.05, openUsd: 0.4, openCount: 1, remainingUsd: expect.closeTo(0.55, 10) })
    const again = open(dir, 't')
    expect(again.state().remainingUsd).toBeCloseTo(0.55)
    await expect(again.reserve(0.6, 'too much')).rejects.toBeInstanceOf(SpendCapReached)
  })

  it('takes over the lock of a process that died, its open reservations still counted', async () => {
    const dir = tempDir()
    createCap(dir, 't', 1)
    appendFileSync(capFile(dir, 't'), JSON.stringify({ event: 'reserved', id: 'dead-1', usd: 0.5, what: 'x', at: '' }) + '\n')
    writeFileSync(join(dir, 't.lock.1'), '2000000001')
    const cap = open(dir, 't', pid => pid !== 2_000_000_001)
    expect(cap.state()).toMatchObject({ openUsd: 0.5, openCount: 1 })
    expect(cap.spentHereUsd()).toBe(0)
  })

  it('skips a last line the crash cut off, and refuses a ledger broken anywhere else', async () => {
    const dir = tempDir()
    createCap(dir, 't', 1)
    appendFileSync(capFile(dir, 't'), '{"event":"reserved","id":"x","us')
    const cap = openCap(dir, 't')
    expect(cap.state().openCount).toBe(0)
    // The cut-off line is gone, so the next one starts on a line of its own
    ;(await cap.reserve(0.1, 'a')).settle(0.1)
    cap.close()
    expect(readCap(dir, 't').settledUsd).toBeCloseTo(0.1)
    const [created, ...rest] = readFileSync(capFile(dir, 't'), 'utf8').split('\n')
    expect(rest.join('\n')).not.toContain('"id":"x"')
    writeFileSync(capFile(dir, 't'), [created, '{"event":"settled","id":', ...rest].join('\n'))
    expect(() => readCap(dir, 't')).toThrow(/line 2/)
  })

  it('refuses a ledger that reserves an id still open, which would count one reservation in place of two', () => {
    const dir = tempDir()
    createCap(dir, 't', 1)
    const reserved = JSON.stringify({ event: 'reserved', id: 'same-1', usd: 0.4, what: 'x', at: '' }) + '\n'
    appendFileSync(capFile(dir, 't'), reserved + reserved)
    expect(() => readCap(dir, 't')).toThrow(/line 3/)
  })
})

describe('one process at a time', () => {
  it('refuses a second opening while the cap is in use, and opens again once it is closed', () => {
    const dir = tempDir()
    createCap(dir, 't', 1)
    const cap = openCap(dir, 't')
    expect(() => openCap(dir, 't')).toThrow(/in use by process/)
    cap.close()
    open(dir, 't')
  })

  it('refuses new reservations once closed', async () => {
    const dir = tempDir()
    createCap(dir, 't', 1)
    const cap = openCap(dir, 't')
    cap.close()
    await expect(cap.reserve(0.1, 'a')).rejects.toBeInstanceOf(SpendRefused)
  })
})

describe('settledUsd', () => {
  it('settles an answer at its real cost, or at the reservation when it gives none', () => {
    expect(settledUsd(0.5, 200, 0.01)).toBe(0.01)
    expect(settledUsd(0.5, 200, null)).toBe(0.5)
  })

  it('settles a rejected request at nothing, but a timeout answer at the reservation', () => {
    expect(settledUsd(0.5, 400, null)).toBe(0)
    expect(settledUsd(0.5, 429, null)).toBe(0)
    expect(settledUsd(0.5, 408, null)).toBe(0.5)
  })

  it('settles a server error, a timeout, an abort or a lost connection at the full reservation', () => {
    expect(settledUsd(0.5, 500, null)).toBe(0.5)
    expect(settledUsd(0.5, 503, 0.01)).toBe(0.5)
    expect(settledUsd(0.5, null, null)).toBe(0.5)
  })
})

describe('the installed guard', () => {
  it('is none until an eval command installs one, and only one per process', () => {
    expect(spendGuard()).toBeNull()
    installSpendGuard(NO_CAP)
    expect(spendGuard()).toBe(NO_CAP)
    expect(() => installSpendGuard(NO_CAP)).toThrow(/already/)
  })

  it('without a cap refuses every paid request', async () => {
    await expect(NO_CAP.reserve(0.001, 'openai gpt-6-luna')).rejects.toThrow(/--cap/)
    await expect(NO_CAP.reserve(0.001, 'x')).rejects.toBeInstanceOf(SpendRefused)
  })
})

describe('spendRefusalOf', () => {
  it('finds a refusal itself, inside the errors wrapped around it, and in an SDK error made from a refusal answer', () => {
    expect(spendRefusalOf(new SpendCapReached('t', 0.5, 0.1))).toMatchObject({ kind: 'cap-reached' })
    expect(spendRefusalOf(new Error('connection error', { cause: new SpendRefused('no cap') }))).toEqual({ kind: 'refused', message: 'no cap' })
    const sdkError = Object.assign(new Error('402 spend cap reached'), { status: 402, code: SPEND_CAP_REACHED_CODE, error: { message: 'left $0.10' } })
    expect(spendRefusalOf(sdkError)).toEqual({ kind: 'cap-reached', message: 'left $0.10' })
    expect(spendRefusalOf(new Error('429 rate limit'))).toBeNull()
  })
})

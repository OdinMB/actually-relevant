/**
 * The task spend cap (`.context/model-eval.md`, "Spend: the task cap and the folder budget"): a named,
 * fixed USD amount that every paid OpenAI and Tavily request a process makes is held to, at the two
 * HTTP choke points (`lib/openaiSpend.ts`, `lib/tavily.ts`). A request is sent only after its worst
 * case is reserved, and its reservation is replaced by its real cost once it ends (`settledUsd`), so at
 * every moment the settled spend plus the open reservations stay within the cap.
 *
 * The cap is an append-only ledger, `<dir>/<name>.jsonl`, one line per event (`created`, `reserved`,
 * `settled`), each written and flushed to disk before the request is sent or once it ended. Loading
 * counts a reservation that was never settled at its full amount, so a crash never under-counts. Its
 * amount is the `created` line's and nothing raises it: a bigger budget is a new cap. One process uses
 * a cap at a time (`lib/pidLock.ts`); a holder that died is taken over, its open reservations staying.
 *
 * The guard is installed per process (`installSpendGuard`), by an eval command only: with none
 * installed, as in production, the choke points send every request exactly as before.
 */
import { randomBytes } from 'node:crypto'
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, truncateSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { createLogger } from './logger.js'
import { lockHolder, LockHeld, pidAlive, takePidLock } from './pidLock.js'

const log = createLogger('spend-cap')

const usd = (v: number) => `$${v.toFixed(4)}`

/** What is left of the cap cannot hold the request's worst case, and no request of this process in flight could make room. */
export class SpendCapReached extends Error {
  constructor(name: string, wantedUsd: number, leftUsd: number) {
    super(`spend cap ${name} reached: a request that may cost up to ${usd(wantedUsd)} does not fit in the ${usd(leftUsd)} left`)
    this.name = 'SpendCapReached'
  }
}

/** A paid request the guard will not send: no cap is installed, or its worst case cannot be read from the request. */
export class SpendRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SpendRefused'
  }
}

/** The error codes of the answer a refused OpenAI request gets (`lib/openaiSpend.ts`), which the SDK carries as `code`. */
export const SPEND_CAP_REACHED_CODE = 'spend_cap_reached'
export const SPEND_REFUSED_CODE = 'spend_refused'

export interface SpendRefusal {
  kind: 'cap-reached' | 'refused'
  message: string
}

/** Whether `err` is a refusal of the guard: itself, an error wrapped around one (`cause`), or an SDK error made from a refusal answer. */
export function spendRefusalOf(err: unknown): SpendRefusal | null {
  let e: unknown = err
  for (let depth = 0; depth < 6 && typeof e === 'object' && e !== null; depth++) {
    if (e instanceof SpendCapReached) return { kind: 'cap-reached', message: e.message }
    if (e instanceof SpendRefused) return { kind: 'refused', message: e.message }
    const { code, error, message } = e as { code?: unknown; error?: { message?: unknown }; message?: unknown }
    if (code === SPEND_CAP_REACHED_CODE || code === SPEND_REFUSED_CODE) {
      const text = typeof error?.message === 'string' ? error.message : String(message)
      return { kind: code === SPEND_CAP_REACHED_CODE ? 'cap-reached' : 'refused', message: text }
    }
    e = (e as { cause?: unknown }).cause
  }
  return null
}

/**
 * What a request settles at, by how it ended: an answer (2xx) at its real cost when the answer gives
 * it, else at its reservation; a rejection (4xx) at nothing, since OpenAI and Tavily bill no request
 * they reject, but a 408 at its reservation, since the request may have been worked on; anything else
 * (a 5xx, a timeout, an abort, a lost connection: `status` null) at its full reservation, since it
 * may have been billed.
 */
export function settledUsd(reservedUsd: number, status: number | null, realUsd: number | null): number {
  if (status !== null && status >= 200 && status < 300) return realUsd ?? reservedUsd
  if (status !== null && status >= 400 && status < 500 && status !== 408) return 0
  return reservedUsd
}

export interface Reservation {
  readonly usd: number
  /** Replace the reservation by what the request cost; a second call changes nothing. */
  settle(usd: number): void
}

export interface SpendGuard {
  /** Hold `usd`, the request's worst case, before it is sent; throws `SpendCapReached` or `SpendRefused` instead. */
  reserve(usd: number, what: string): Promise<Reservation>
}

let installed: SpendGuard | null = null

/** The guard the choke points send through; null outside an eval command. */
export function spendGuard(): SpendGuard | null {
  return installed
}

/** Install the process's guard, once, before any request is sent. */
export function installSpendGuard(guard: SpendGuard): void {
  if (installed) throw new Error('a spend guard is already installed in this process')
  installed = guard
}

/** For tests only: no guard installed, as in production. */
export function _resetSpendGuard(): void {
  installed = null
}

/** An eval command run without a cap: a cached, dry or cache-only run needs none, and a live paid request is refused. */
export const NO_CAP: SpendGuard = {
  reserve: () =>
    Promise.reject(
      new SpendRefused(
        'no spend cap: a live OpenAI or Tavily request needs --cap <name> (create one with npm run eval:cap --prefix server -- new <name> --usd <n>)',
      ),
    ),
}

// ---------------------------------------------------------------------------
// The cap on disk
// ---------------------------------------------------------------------------

const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

/** A cap's name, refused unless it is a plain file name: letters, digits, `-` and `_`. */
export function capName(name: string): string {
  if (!NAME.test(name)) throw new Error(`a cap's name is 1 to 64 letters, digits, - or _, starting with a letter or digit; got "${name}"`)
  return name
}

export const capFile = (dir: string, name: string) => join(dir, `${capName(name)}.jsonl`)

type CapEvent =
  | { event: 'created'; name: string; usd: number; at: string }
  | { event: 'reserved'; id: string; usd: number; what: string; at: string }
  | { event: 'settled'; id: string; usd: number; at: string }

export interface CapState {
  name: string
  capUsd: number
  createdAt: string
  /** What settled requests cost. */
  settledUsd: number
  /** Reservations not settled: requests in flight, and those of a process that ended before they did, at their full amount. */
  openUsd: number
  openCount: number
  remainingUsd: number
}

interface Replayed {
  created: { usd: number; at: string }
  settled: number
  open: Map<string, number>
}

/** The ledger's events in order; a last line an interrupted write cut off is skipped (its request was never sent). */
function replay(text: string, file: string): Replayed {
  const lines = text.split('\n')
  const cut = text.endsWith('\n') ? '' : (lines.pop() ?? '')
  if (cut.trim() !== '') log.warn({ file }, 'skipped an unfinished last line in the spend cap ledger')
  let created: Replayed['created'] | null = null
  let settled = 0
  const open = new Map<string, number>()
  lines.forEach((line, i) => {
    if (!line.trim()) return
    let e: CapEvent
    try {
      e = JSON.parse(line) as CapEvent
    } catch {
      throw new Error(`${file}: line ${i + 1} is broken; the ledger cannot be read, so the cap cannot be used`)
    }
    if (e.event === 'created') {
      if (created) throw new Error(`${file}: a second amount on line ${i + 1}; a cap's amount is fixed`)
      created = { usd: e.usd, at: e.at }
    } else if (!created) {
      throw new Error(`${file}: line ${i + 1} comes before the cap's amount`)
    } else if (e.event === 'reserved') {
      if (open.has(e.id)) throw new Error(`${file}: line ${i + 1} reserves an id still open; the ledger cannot be read, so the cap cannot be used`)
      open.set(e.id, e.usd)
    } else if (e.event === 'settled' && open.has(e.id)) {
      open.delete(e.id)
      settled += e.usd
    } else {
      throw new Error(`${file}: line ${i + 1} settles no open reservation`)
    }
  })
  if (!created) throw new Error(`${file}: no amount; the cap was never created whole`)
  return { created, settled, open }
}

const sum = (values: Iterable<number>) => [...values].reduce((a, b) => a + b, 0)

function stateOf(name: string, r: Pick<Replayed, 'created' | 'settled' | 'open'>): CapState {
  const openUsd = sum(r.open.values())
  return {
    name,
    capUsd: r.created.usd,
    createdAt: r.created.at,
    settledUsd: r.settled,
    openUsd,
    openCount: r.open.size,
    remainingUsd: Math.max(0, r.created.usd - r.settled - openUsd),
  }
}

/** Write one event and flush it to disk before going on. */
function append(fd: number, event: CapEvent): void {
  writeSync(fd, JSON.stringify(event) + '\n')
  fsyncSync(fd)
}

/** Create a cap of `amountUsd`; refused when one of that name exists, whatever its amount. */
export function createCap(dir: string, name: string, amountUsd: number, now = new Date()): CapState {
  const file = capFile(dir, name)
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) throw new Error(`a cap's amount is a positive number of USD; got ${amountUsd}`)
  mkdirSync(dir, { recursive: true })
  let fd: number
  try {
    fd = openSync(file, 'wx')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    throw new Error(`cap ${name} exists (${usd(readCap(dir, name).capUsd)}); its amount can never be raised: a bigger budget is a new cap`, { cause: err })
  }
  try {
    append(fd, { event: 'created', name, usd: amountUsd, at: now.toISOString() })
  } finally {
    closeSync(fd)
  }
  return readCap(dir, name)
}

/** The ledger's text; a cap never created is named as such. */
function ledgerText(dir: string, name: string): string {
  try {
    return readFileSync(capFile(dir, name), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT')
      throw new Error(`no cap named ${name} in ${dir}: create it with eval:cap new ${name} --usd <n>`, { cause: err })
    throw err
  }
}

/** A cap's state as its ledger has it, without taking it; `inUseBy` is the live process using it. */
export function readCap(dir: string, name: string): CapState & { inUseBy: number | null } {
  return { ...stateOf(name, replay(ledgerText(dir, name), capFile(dir, name))), inUseBy: lockHolder(join(dir, name)) }
}

export interface TaskCap extends SpendGuard {
  readonly name: string
  state(): CapState
  /** This process's spend: what it settled plus its reservations still open. */
  spentHereUsd(): number
  /** Stop reserving and give the cap up; reservations still open stay counted in full. */
  close(): void
}

/** Take a cap for this process: refused while another live process uses it. */
export function openCap(dir: string, name: string, alive: (pid: number) => boolean = pidAlive): TaskCap {
  const file = capFile(dir, name)
  // A cap never created is refused here, before any lock file is made for it
  ledgerText(dir, name)
  let lock
  try {
    lock = takePidLock(join(dir, name), alive)
  } catch (err) {
    if (err instanceof LockHeld) throw new Error(`cap ${name} is ${err.message}`, { cause: err })
    throw err
  }
  let fd: number
  let ledger: Replayed
  try {
    const text = ledgerText(dir, name)
    ledger = replay(text, file)
    // A line an interrupted write left unfinished goes, so the next one starts on a line of its own
    if (!text.endsWith('\n')) truncateSync(file, Buffer.byteLength(text.slice(0, text.lastIndexOf('\n') + 1)))
    fd = openSync(file, 'a')
  } catch (err) {
    lock.release()
    throw err
  }
  const capUsd = ledger.created.usd
  let settled = ledger.settled
  const open = ledger.open
  /** This process's reservations in flight: the ones whose release could make room. */
  const mine = new Map<string, number>()
  let settledHere = 0
  let closed = false
  let waiters: (() => void)[] = []
  const tag = randomBytes(6).toString('hex')
  let next = 0
  /** An id no reservation in the ledger holds open, so a new one can never stand in for an open one. */
  const freshId = () => {
    let id = `${tag}-${++next}`
    while (open.has(id)) id = `${tag}-${++next}`
    return id
  }

  const wake = () => {
    const woken = waiters
    waiters = []
    for (const w of woken) w()
  }

  function settle(id: string, reserved: number, real: number): void {
    if (!mine.has(id)) return
    mine.delete(id)
    const cost = Number.isFinite(real) && real >= 0 ? real : reserved
    if (cost > reserved) log.warn({ cap: name, reservedUsd: reserved, costUsd: cost }, 'a request cost more than its worst case: check the price table')
    try {
      append(fd, { event: 'settled', id, usd: cost, at: new Date().toISOString() })
      open.delete(id)
      settled += cost
      settledHere += cost
    } catch (err) {
      // Left open, so counted in full: the cap over-counts rather than under-counts
      log.error({ err, cap: name }, 'could not record a settled request; its reservation stays counted in full')
    }
    wake()
  }

  return {
    name,
    async reserve(amount, what) {
      if (!Number.isFinite(amount) || amount <= 0) throw new SpendRefused(`a request's worst case must be a positive amount; got ${amount}`)
      for (;;) {
        if (closed) throw new SpendRefused(`spend cap ${name} was closed`)
        const held = settled + sum(open.values())
        if (held + amount <= capUsd) {
          const id = freshId()
          append(fd, { event: 'reserved', id, usd: amount, what, at: new Date().toISOString() })
          open.set(id, amount)
          mine.set(id, amount)
          return { usd: amount, settle: real => settle(id, amount, real) }
        }
        const releasable = sum(mine.values())
        if (releasable === 0 || held - releasable + amount > capUsd) throw new SpendCapReached(name, amount, Math.max(0, capUsd - held))
        await new Promise<void>(resolve => waiters.push(resolve))
      }
    },
    state: () => stateOf(name, { created: ledger.created, settled, open }),
    spentHereUsd: () => settledHere + sum(mine.values()),
    close() {
      if (closed) return
      closed = true
      wake()
      closeSync(fd)
      lock.release()
    },
  }
}

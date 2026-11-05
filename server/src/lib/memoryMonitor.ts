/**
 * Process memory in the logs, so a host memory alert comes with numbers (.context/logging.md,
 * "Memory"). A line every few minutes, a warn once RSS reaches the threshold, and the RSS on every
 * scheduled job's completion line, which ties a jump to the job that caused it.
 */
import { config } from '../config.js'
import { createLogger } from './logger.js'

const log = createLogger('memory')

export interface MemorySnapshot {
  rssMb: number
  heapUsedMb: number
  heapTotalMb: number
  externalMb: number
  arrayBuffersMb: number
}

const toMb = (bytes: number) => Math.round(bytes / (1024 * 1024))

/** The process's memory now, in whole MiB. */
export function memorySnapshot(): MemorySnapshot {
  const m = process.memoryUsage()
  return {
    rssMb: toMb(m.rss),
    heapUsedMb: toMb(m.heapUsed),
    heapTotalMb: toMb(m.heapTotal),
    externalMb: toMb(m.external),
    arrayBuffersMb: toMb(m.arrayBuffers),
  }
}

/** Logs one snapshot: info below the warn threshold, warn at or above it. */
export function logMemory(): void {
  const snapshot = memorySnapshot()
  if (snapshot.rssMb >= config.memory.warnRssMb) log.warn(snapshot, 'memory high')
  else log.info(snapshot, 'memory')
}

let timer: NodeJS.Timeout | null = null

/** Starts the periodic memory line (idempotent). The timer never keeps the process alive. */
export function startMemoryMonitor(): void {
  if (timer) return
  timer = setInterval(logMemory, config.memory.logIntervalMs)
  timer.unref()
}

export function stopMemoryMonitor(): void {
  if (timer) clearInterval(timer)
  timer = null
}

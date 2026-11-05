import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockLog = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }))
vi.mock('./logger.js', () => ({ createLogger: () => mockLog }))

import { config } from '../config.js'
import { logMemory, memorySnapshot, startMemoryMonitor, stopMemoryMonitor } from './memoryMonitor.js'

const MB = 1024 * 1024

function usage(rssMb: number) {
  return { rss: rssMb * MB, heapUsed: 100 * MB, heapTotal: 150 * MB, external: 20 * MB, arrayBuffers: 5 * MB }
}

describe('memoryMonitor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    stopMemoryMonitor()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('reports memory in whole MiB', () => {
    vi.spyOn(process, 'memoryUsage').mockReturnValue(usage(300) as NodeJS.MemoryUsage)
    expect(memorySnapshot()).toEqual({ rssMb: 300, heapUsedMb: 100, heapTotalMb: 150, externalMb: 20, arrayBuffersMb: 5 })
  })

  it('logs info below the threshold and warn at or above it', () => {
    vi.spyOn(process, 'memoryUsage').mockReturnValue(usage(config.memory.warnRssMb - 1) as NodeJS.MemoryUsage)
    logMemory()
    expect(mockLog.info).toHaveBeenCalledWith(expect.objectContaining({ rssMb: config.memory.warnRssMb - 1 }), 'memory')
    expect(mockLog.warn).not.toHaveBeenCalled()

    vi.spyOn(process, 'memoryUsage').mockReturnValue(usage(config.memory.warnRssMb) as NodeJS.MemoryUsage)
    logMemory()
    expect(mockLog.warn).toHaveBeenCalledWith(expect.objectContaining({ rssMb: config.memory.warnRssMb }), 'memory high')
  })

  it('logs on every interval once started, and stops', () => {
    vi.useFakeTimers()
    vi.spyOn(process, 'memoryUsage').mockReturnValue(usage(200) as NodeJS.MemoryUsage)
    startMemoryMonitor()
    startMemoryMonitor() // idempotent: still one timer
    vi.advanceTimersByTime(config.memory.logIntervalMs * 2)
    expect(mockLog.info).toHaveBeenCalledTimes(2)
    stopMemoryMonitor()
    vi.advanceTimersByTime(config.memory.logIntervalMs)
    expect(mockLog.info).toHaveBeenCalledTimes(2)
  })
})

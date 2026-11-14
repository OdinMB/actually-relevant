import { randomUUID } from 'crypto'
import { createLogger } from './logger.js'

const log = createLogger('taskRegistry')

/**
 * `research`: research runs, one story's (services/researchRuns.ts) or the stories list's bulk
 * Research (services/researchBatch.ts); its stories count as processing while it runs.
 */
export type BulkTaskType = 'preassess' | 'assess' | 'select' | 'reclassify' | 'emotion' | 'research'
type BulkTaskStatus = 'running' | 'completed' | 'failed'

/** A story the task left out, with why; neither completed nor failed. */
export interface TaskSkip {
  storyId: string
  reason: string
}

export interface TaskStateResponse {
  id: string
  type: BulkTaskType
  status: BulkTaskStatus
  total: number
  completed: number
  failed: number
  errors: string[]
  skipped: TaskSkip[]
  storyIds: string[]
  createdAt: string
  completedAt?: string
}

interface InternalTaskState {
  id: string
  type: BulkTaskType
  status: BulkTaskStatus
  total: number
  completed: number
  failed: number
  errors: string[]
  skipped: TaskSkip[]
  storyIds: string[]
  createdAt: Date
  completedAt?: Date
}

const MAX_ERRORS = 20
const CLEANUP_INTERVAL_MS = 60_000
const COMPLETED_TTL_MS = 10 * 60_000

class TaskRegistry {
  private tasks = new Map<string, InternalTaskState>()
  private cleanupTimer: ReturnType<typeof setInterval>

  constructor() {
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS)
  }

  create(type: BulkTaskType, total: number, storyIds: string[]): string {
    const id = randomUUID()
    this.tasks.set(id, {
      id,
      type,
      status: 'running',
      total,
      completed: 0,
      failed: 0,
      errors: [],
      skipped: [],
      storyIds,
      createdAt: new Date(),
    })
    log.info({ taskId: id, type, total }, 'task created')
    return id
  }

  get(taskId: string): TaskStateResponse | undefined {
    const task = this.tasks.get(taskId)
    if (!task) return undefined
    return {
      id: task.id,
      type: task.type,
      status: task.status,
      total: task.total,
      completed: task.completed,
      failed: task.failed,
      errors: task.errors,
      skipped: task.skipped,
      storyIds: task.storyIds,
      createdAt: task.createdAt.toISOString(),
      completedAt: task.completedAt?.toISOString(),
    }
  }

  increment(taskId: string, field: 'completed' | 'failed', error?: string): void {
    const task = this.tasks.get(taskId)
    if (!task) return
    task[field]++
    if (error && task.errors.length < MAX_ERRORS) {
      task.errors.push(error)
    }
  }

  /** Record a story the task left out, with why; a batch of at most `total` stories bounds the list. */
  skip(taskId: string, storyId: string, reason: string): void {
    const task = this.tasks.get(taskId)
    if (!task) return
    task.skipped.push({ storyId, reason })
  }

  complete(taskId: string): void {
    const task = this.tasks.get(taskId)
    if (!task) return
    // Failed only when every item failed: a skipped one did not
    task.status = task.failed > 0 && task.completed === 0 && task.skipped.length === 0 ? 'failed' : 'completed'
    task.completedAt = new Date()
    log.info({ taskId, status: task.status, completed: task.completed, failed: task.failed }, 'task finished')
  }

  getProcessingStoryIds(): string[] {
    const ids = new Set<string>()
    for (const task of this.tasks.values()) {
      if (task.status === 'running') {
        for (const id of task.storyIds) {
          ids.add(id)
        }
      }
    }
    return Array.from(ids)
  }

  private cleanup(): void {
    const now = Date.now()
    for (const [id, task] of this.tasks) {
      if (task.completedAt && now - task.completedAt.getTime() > COMPLETED_TTL_MS) {
        this.tasks.delete(id)
      }
    }
  }

  /** Clear all tasks (for testing). Does not stop the cleanup timer. */
  clear(): void {
    this.tasks.clear()
  }

  destroy(): void {
    clearInterval(this.cleanupTimer)
    this.tasks.clear()
  }
}

export const taskRegistry = new TaskRegistry()

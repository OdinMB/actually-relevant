# Server-Side Task Queue

## Overview

Bulk LLM operations run as background tasks on the server with concurrency control via `Semaphore`. The client submits a single request and polls for progress. Task types (`BulkTaskType` in `shared/types/index.ts` and `server/src/lib/taskRegistry.ts`): `preassess`, `assess`, `select`, `reclassify` (issue reassignment) and `emotion` (emotion tagging only).

## Architecture

```
Client                          Server
  |                               |
  |-- POST /bulk-assess --------->|  Creates TaskState, returns 202 {taskId}
  |                               |  Kicks off background processing
  |-- GET /tasks/:taskId -------->|  Returns {completed, failed, total, status}
  |   (poll every 2s)             |
  |-- GET /tasks/:taskId -------->|  status: "completed"
  |   (stop polling)              |
```

## Server Components

### Task Registry (`server/src/lib/taskRegistry.ts`)

In-memory `Map<string, TaskState>` singleton. Tasks are ephemeral — created on bulk request, auto-cleaned 10 minutes after completion.

- `create(type, total, storyIds)` — Returns `taskId` (UUID)
- `get(taskId)` — Returns serialized `TaskStateResponse` or `undefined`
- `increment(taskId, 'completed' | 'failed', error?)` — Updates counters
- `complete(taskId)` — Marks task as completed/failed based on counters
- `getProcessingStoryIds()` — Returns all story IDs from running tasks (used for UI indicators)
- `clear()` — Testing utility to reset state
- `destroy()` — Stops cleanup timer and clears all tasks

### Task Lifecycle

A task is created with status `running`, counters `completed = 0` and `failed = 0`, an empty `errors` list, its `storyIds` and `createdAt`. Each processed story adds one to `completed` or `failed`. A failure message is added to `errors` only while fewer than 20 are stored (`MAX_ERRORS`). When every item has been processed, `complete()` sets `completedAt`. The status becomes `failed` only if **every** item failed (`failed > 0 && completed === 0`); otherwise it becomes `completed`, including when only some items failed. A cleanup timer runs every 60 s (`CLEANUP_INTERVAL_MS`) and removes tasks whose `completedAt` is more than 10 minutes old (`COMPLETED_TTL_MS`). A task that never completes is never removed.

### Bulk Analysis Functions (`server/src/services/analysis.ts`)

Fire-and-forget wrappers (`bulkReclassify` and `bulkTagEmotions` follow the same pattern as the three below) that accept a `taskId` and update progress:

- `bulkPreAssess(storyIds, taskId)` — Reuses existing `preAssessStories()` batching, updates progress after completion
- `bulkAssess(storyIds, taskId)` — Runs each story through `assessStory()` gated by `Semaphore(config.concurrency.assess)`
- `bulkSelect(storyIds, taskId)` — Single LLM call via `selectStories()`, progress is 0 -> done

### API Endpoints (`server/src/routes/admin/stories.ts`)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/stories/bulk-preassess` | Submit bulk preassess. Returns `202 { taskId }`. |
| `POST` | `/stories/bulk-assess` | Submit bulk assess. Returns `202 { taskId }`. |
| `POST` | `/stories/bulk-select` | Submit bulk select. Returns `202 { taskId }`. |
| `POST` | `/stories/bulk-reclassify` | Submit bulk issue reassignment. Returns `202 { taskId }`. |
| `POST` | `/stories/bulk-tag-emotions` | Submit bulk emotion tagging. Returns `202 { taskId }`. |
| `GET` | `/stories/tasks/:taskId` | Poll task progress. Returns `TaskStateResponse`. |
| `GET` | `/stories/processing` | Get all story IDs currently being processed. |

All bulk endpoints validate `{ storyIds: string[] }` via `bulkStoryIdsSchema` (1-500 UUIDs). IDs already in a running task are dropped (`filterProcessingIds`) and returned as `skipped`; if none remain, the endpoint answers 409.

## Client Components

### Admin API (`client/src/lib/admin-api.ts`)

Methods: `bulkPreassess`, `bulkAssess`, `bulkSelect`, `taskStatus`, `processing`.

### Background Task Context (`client/src/hooks/useBackgroundTasks.tsx`)

- `launchTask(options)` — For immediate executor-based tasks (single-story operations)
- `launchPolledTask(options)` — For server-polled bulk tasks. Calls `submitFn()` to get `taskId`, then polls every 2 seconds.
- `processingIds: Set<string>` — Tracks which story IDs are currently being processed (from both task types). Used by `StoryTable` to show processing indicators.

Both `launchTask` and `launchPolledTask` accept an optional `storyIds` parameter to populate `processingIds`.

### Story Table (`client/src/components/admin/StoryTable.tsx`)

A story counts as "processing" when its ID belongs to any task whose status is `running`, across all tasks (`getProcessingStoryIds()`, `GET /stories/processing`). The client shows progress as (`completed` + `failed`) / `total`.

Accepts `processingIds?: Set<string>`. When a story is processing:
- Row gets a light brand-colored background
- Spinning arrow icon appears next to the title
- Action buttons are replaced with "Processing..." text

## Concurrency

Server-side concurrency is configured via environment variables (see `.context/scheduler.md`):
- `CONCURRENCY_PREASSESS` (default: 10)
- `CONCURRENCY_ASSESS` (default: 10)
- `CONCURRENCY_SELECT` (default: 10)

The client sends up to 500 IDs in a single request. The server gates LLM calls through `Semaphore`.

## Limitations

- **In-memory only** — Tasks are lost on server restart. Client shows an error on next poll.
- **Per-process deduplication only** — Stories already in a running task are skipped (see API Endpoints), but the check lives in this process's memory. Semaphore prevents LLM overload.
- **No persistence** — Task history is not stored in the database.

## Key Files

| File | Purpose |
|------|---------|
| `server/src/lib/taskRegistry.ts` | In-memory task state |
| `server/src/lib/taskRegistry.test.ts` | Task registry unit tests |
| `server/src/services/analysis.ts` | Bulk wrapper functions |
| `server/src/routes/admin/stories.ts` | Bulk + poll endpoints |
| `server/src/schemas/story.ts` | `bulkStoryIdsSchema` validation |
| `client/src/lib/admin-api.ts` | Client API methods |
| `client/src/hooks/useBackgroundTasks.tsx` | Polling + processing ID tracking |
| `client/src/components/admin/StoryTable.tsx` | Processing indicator UI |
| `client/src/pages/admin/StoriesPage.tsx` | Wires bulk actions to polled tasks |
| `shared/types/index.ts` | `TaskState`, `BulkTaskType`, `BulkTaskStatus` types |

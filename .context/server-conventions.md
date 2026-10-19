# Server Conventions

Patterns every Express route and service in `server/src/` follows, beyond the subsystem docs.

## Route errors

A thrown error becomes a response in exactly one place: `errorHandler` in `server/src/middleware/routeErrors.ts`, registered last in `app.ts`. `express-async-errors` (imported first in `app.ts`) routes every rejected promise from an async handler there, so routes do not catch.

**Services throw typed errors, never match on messages.** For any failure a route must answer with a 4xx, a service throws a subclass of `ServiceError` (`server/src/utils/errors.ts`), which carries its status:

| Class | Status | Use |
|-------|--------|-----|
| `BadRequestError` | 400 | The request names something invalid: a body field referencing a missing row (`feedId`, `issueId`, a merge source), a rule the change breaks ("Story is not in a cluster", "No stories selected") |
| `UnauthorizedError` | 401 | Credentials or a token rejected (`RefreshTokenRejectedError`, a wrong current password) |
| `NotFoundError` | 404 | The resource the URL names does not exist ("Story not found", "Newsletter not found") |
| `ConflictError` | 409 | The resource's state refuses the change (`PodcastRefusedError`, "URL already crawled", "Cannot delete issue with existing feeds", `TestSegmentNotConfiguredError`) |
| `UnprocessableError` | 422 | Well-formed but breaking a content rule (`PodcastEditRejectedError`) |

The body is `{ error: message }`; a subclass that needs more overrides `toBody()` (`PodcastEditRejectedError` adds `errors` and `warnings`, `StoriesAlreadyClusteredError` adds `storyIds`). The message is free to reword: nothing compares it. Whether a missing row is a 400 or a 404 is decided where it is thrown (a row the URL names is 404, a row the body references is 400), so the same text can mean either. A failure that is not the caller's to fix stays a plain `Error` and is a 500.

**Routes name their texts with `failsWith()`.** It goes first in the route's middleware and tells the handler what this route answers for anything that is not a `ServiceError`:

```ts
router.put('/:id', failsWith('Failed to update feed', { notFound: 'Feed not found', duplicate: 'A feed with this RSS URL already exists' }), validateBody(updateFeedSchema), async (req, res) => {
  res.json(await feedService.updateFeed(req.params.id, req.body))
})
```

| Thrown | Answer |
|--------|--------|
| a `ServiceError` | its `status` and `toBody()`; not logged (the request log line records the 4xx) |
| Prisma `P2025` (no row to update or delete) | 404 `{ error: notFound ?? 'Not found' }` |
| Prisma `P2002` (unique constraint) | 409 `{ error: duplicate ?? 'Already exists' }` |
| anything else | logged at error level with the request id, 500 `{ error: failure ?? 'Internal server error' }` |

A response already under way (a streamed download such as the newsletter carousel ZIP) is handed back to Express, which closes the connection. A route still writes its own 4xx inline when the check is the route's (a `findOr404` lookup, a validation the route does). A route keeps a `catch` only when it must act on the failure before it is answered: `/api/auth/refresh` clears the cookie on `RefreshTokenRejectedError` and rethrows; `/api/subscribe` answers its typed signup errors as `200 { success: false }` by design; `/api/auth/logout` and `/api/auth/me` answer every failure the same way on purpose. Some public routes (`routes/public/*`) still carry older `catch` blocks that only log and answer 500; they behave the same and move to `failsWith()` when touched.

Tests: `middleware/routeErrors.test.ts` covers the handler; route tests reject service mocks with the typed classes (import them from `utils/errors.js`, or with `importOriginal` when the service module is mocked) and assert the status and body.

## Test-only exports

A module that holds process state exports a `_reset…()` function (or another `_`-prefixed export) for tests only, e.g. `_resetShutdownState` in `index.ts` and `_resetApiState` in `services/extractor.ts`. Application code never calls an `_`-prefixed export; tests call it in `beforeEach`.

## Key Files

| File | What |
|------|------|
| `server/src/utils/errors.ts` | `ServiceError` and its subclasses, `summarizeError` |
| `server/src/middleware/routeErrors.ts` | `failsWith()`, `errorHandler` |
| `server/src/app.ts` | Registers `errorHandler` last |
| `server/src/routes/admin/socialChannel.ts` | One router for every social channel (Bluesky, Mastodon), parameterized by the channel's service and schemas |

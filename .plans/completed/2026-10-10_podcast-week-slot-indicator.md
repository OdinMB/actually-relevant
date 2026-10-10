---
plan-id: 2026-10-10-podcast-week-slot-indicator
title: Show whether this week's podcast slot is claimed, and warn before claiming it
status: implemented
created: 2026-10-10
author: claude-code (AI)
repo: OdinMB/actually-relevant
themes: []
decisions: []
type: feature
complexity: complex
---

# This week's podcast slot: indicator and claim warning

Behavior approved by the owner (relayed request, 2026-10-10): "yes to warning, plus some indicator if this week's podcast slot is already claimed". The task text gave the indicator's states, the dialog, and the read-only endpoint. The agent made the design calls below. None of them is an architectural decision under DOC-006, so `decisions:` is empty. Each is explained in `## Approach`.

Related plans: `.plans/completed/2026-10-06_autonomous-two-speaker-podcast.md` (weekly run, cron window), `.plans/completed/2026-10-07_podcast-standalone-episodes.md` ("New podcast", no week key). Read `.context/podcast.md` first.

## Problem

Each ISO week (UTC) has one weekly episode, keyed by its unique `weekKey`. "Start this week's episode" creates the week's row silently, and the Friday `generate_podcast` run then works on that row: it finishes it, skips it, or leaves it for a person. The owner claimed a week with a midweek test episode, and Friday made no automatic episode. Nothing on the Podcasts page shows that the slot is taken or what Friday will do with it, and nothing warns before the slot is claimed.

## Approach

**Server: one read-only slot view, built on the cron's own rules.**

1. `podcastWeekly.ts` gets a pure `weeklyCronAction(episode)`, which returns `'finished' | 'waiting-for-person' | 'blocked' | 'advance'`. It applies `runEpisode`'s cron rules in their current order: a published or `ready` episode is finished; an interactive one waits for its person, even when blocked; a blocked one is skipped; anything else advances, including mode null, which the cron sets to automated. `runEpisode` itself switches to this function for its cron-trigger branches, so the indicator and the cron cannot drift apart. The admin-trigger path keeps its own finished check and its clear-block logic. This is a pure refactor of `runEpisode`, and the existing `podcastWeekly.test.ts` cases must stay green unchanged.
2. A new module, `server/src/services/podcastWeekSlot.ts`, holds the Friday window and the slot reader:
   - `fridayWindow(now)` returns `'ahead' | 'open' | 'passed'` (UTC). `open` means Friday 00:00 until `config.podcast.generateWindowEndHourUtc`. `passed` means Friday from that hour through Sunday, which is still the same ISO week. `ahead` is Monday to Thursday. This moves the rule out of `generatePodcast.ts`: `inGenerateWindow` is deleted, and `runGeneratePodcast` checks `fridayWindow(now) !== 'open'`. The window then lives in one place.
   - `getWeekSlot(now)` reads without creating anything. It computes `weekKey = isoWeekKey(now)`, reads the week's row as a list item through a new `getWeekEpisodeListItem(weekKey)` in `podcast.ts` (LIST_COLUMNS plus `withProgress`, so `PodcastStageBadge` works on the client), and reads `generate_podcast`'s `enabled` flag from `jobRun`. It returns `{ weekKey, episode: PodcastListItem | null, fridayRun: 'create' | WeeklyCronAction, fridayWindow, automaticRunEnabled }`, with `fridayRun = 'create'` when there is no row.
   - The module follows the precedent of `podcastMissedWeek.ts`: a separate service that imports `isoWeekKey` from `podcastWeekly.ts`. It keeps the admin read out of `podcastWeekly.ts`, which already owns four concerns (the week's row, runs, retry/block policy, and the ready notice), and services never import from `jobs/` (none do today).
3. `GET /api/admin/podcasts/weekly` returns `getWeekSlot()`. It must be registered **before** `GET /:id`, because otherwise `/:id` would match `weekly`. The POST at the same path stays as it is.

**`automaticRunEnabled` (agent's call).** The `generate_podcast` job is seeded disabled. If it is off, "Friday will create the episode" would be false, so the notice says the automatic run is off instead and links to the Jobs page. This costs one indexed read. The alternative was to leave it out and keep the notice wrong whenever the job is off.

**Client.**

- `adminApi.podcasts.weekSlot()` and a `usePodcastWeekSlot()` hook. The hook's query key is `['podcasts', 'week-slot']`, so every existing `invalidateQueries({ queryKey: ['podcasts'] })` refreshes it through the prefix match: store/start (`useStoreEpisode`), delete, and the progress provider when a run ends. This needs no new invalidation calls. The client never computes ISO weeks, and only renders server fields.
- A new `PodcastWeekSlotNotice` component renders one or two lines in a small bordered `<section aria-label="This week's podcast">`. It is not a live region, so a refetch does not trigger an announcement. Copy, in American English, with no em dash:
  - Line 1: free reads "This week's slot (2026-W41) is free." Claimed reads "This week's episode (2026-W41): <Link to /admin/podcasts/:id>title</Link> <PodcastStageBadge>".
  - Line 2, chosen in this order:
    - `!automaticRunEnabled` gives "The automatic Friday run is off, so nothing happens on its own (<Link to /admin/jobs>Jobs</Link>)."
    - `fridayWindow === 'passed'` gives "This week's automatic run is over. The next one is next Friday, for next week's episode."
    - Otherwise, by `fridayRun`:
      - `create`: "Friday's automatic run will create and generate this week's episode."
      - `finished`: "Friday's automatic run makes nothing new this week."
      - `waiting-for-person`: "Friday's automatic run leaves it waiting for you."
      - `blocked`: "Friday's automatic run skips it until you resume it."
      - `advance`: "Friday's automatic run will continue and finish it."
  - While loading, the notice renders nothing. On error it shows one muted line, "Could not check this week's slot." No retry button, because the page has others.
- `PodcastsPage`:
  - When the slot is claimed, the primary button reads "Open this week's episode". It navigates straight to `slot.episode.id`, with no POST and no dialog.
  - Otherwise it reads "Start this week's episode" and opens a `ConfirmDialog`:
    - title: "Make this week's episode?"
    - description: "This becomes this week's episode. Friday's automatic run will then finish or skip it instead of making a new one. For a test or a one-off, use New podcast."
    - confirmLabel: "Start this week's episode"
    - Confirm runs today's `handleStartWeekly`. Cancel closes the dialog and does nothing.
  - While the slot is unknown (loading or error), the button behaves as if the slot were free and shows the dialog. The POST is find-or-create, so the worst case is a warning that wasn't needed, and the button never gets stuck disabled. If the slot was claimed between page load and the click, the POST returns the existing row, as it does today.
- Nothing is added to the public site. The endpoint is under `/api/admin` (auth) and the component is admin-only.

**Alternatives considered.**

- Computing "what Friday will do" in the route or on the client was rejected: it would copy the cron rules, which is the drift the task forbids.
- Putting `getWeekSlot` into `podcastWeekly.ts` was rejected: it would add a fifth concern to a strained file.
- Leaving the window in `generatePodcast.ts` and importing it into a service was rejected: it would reverse the services-to-jobs direction. Duplicating it was also rejected, because of drift.
- A dedicated `invalidateQueries` for the slot in each mutation was rejected: the prefix key gets the same result with no added calls.

## Changes

| File | Change |
|------|--------|
| `server/src/services/podcastWeekly.ts` | Add an exported pure `weeklyCronAction(episode: Pick<Podcast, 'status' \| 'stage' \| 'mode' \| 'blockedAt'>)` and the `WeeklyCronAction` type. `runEpisode`'s cron-trigger branches (interactive wait, blocked skip) and the shared finished check use it. Behavior is unchanged. |
| `server/src/services/podcastWeekSlot.ts` (new) | `fridayWindow(now)` (moved rule) and `getWeekSlot(now)`, read-only. |
| `server/src/services/podcast.ts` | Add `getWeekEpisodeListItem(weekKey)`: the week's row with LIST_COLUMNS and `withProgress`, or null. It belongs to this module's existing job of admin reads. |
| `server/src/jobs/generatePodcast.ts` | Delete `inGenerateWindow`. `runGeneratePodcast` uses `fridayWindow(now) !== 'open'`. Update the header comment. |
| `server/src/routes/admin/podcasts.ts` | `router.get('/weekly', …)` before `/:id`: `res.json(await getWeekSlot())`, and a 500 with `log.error` on failure, as in the neighboring routes. |
| `shared/types/index.ts` | `PodcastWeekSlot` and `PodcastFridayRun` (`'create' \| 'finished' \| 'waiting-for-person' \| 'blocked' \| 'advance'`), with doc comments. The server's `getWeekSlot` return type uses the same union literals. |
| `client/src/lib/admin-api.ts` | `podcasts.weekSlot: () => request<PodcastWeekSlot>('/podcasts/weekly')`. |
| `client/src/hooks/usePodcasts.ts` | `usePodcastWeekSlot()` with the key `['podcasts', 'week-slot']`. Add a comment saying that the prefix key keeps it fresh. |
| `client/src/components/admin/PodcastWeekSlotNotice.tsx` (new) | The compact notice. |
| `client/src/pages/admin/PodcastsPage.tsx` | Render the notice under the header, add the button label and behavior switch, and add the confirm dialog state. |
| `.context/podcast.md` | Admin endpoints table: a new `GET /api/admin/podcasts/weekly` row ("this week's slot without creating a row: `weekKey`, the episode or null, what Friday's run will do (`weeklyCronAction`), the window, whether `generate_podcast` is enabled"). Key-files table: a `podcastWeekSlot.ts` row; the `generatePodcast.ts` row now says the window comes from `fridayWindow`. Admin UI description: the slot notice, the "Open this week's episode" relabel, and the confirm before a claim. Troubleshooting: "Friday made no automatic episode": check the slot notice, since a person may have claimed the week; delete the never-published row to free the week. |

*`podcastWeekSlot.ts`.* Responsibility: this ISO week's slot as the Friday automatic run sees it, which is the UTC window and a read-only view of the week's episode and what the run will do with it. Exports: `fridayWindow`, `getWeekSlot`, and the `FridayWindow` type.

*`PodcastWeekSlotNotice.tsx`.* Responsibility: render the server's slot view as a one- or two-line admin notice. Exports: `PodcastWeekSlotNotice`.

## Tests

Server (vitest, `vi.hoisted` mocks):

- `podcastWeekly.test.ts`: add a `weeklyCronAction` table covering published, ready, interactive (also when blocked, and also when ready, which gives finished), blocked automated, mode null, and automated in progress. The existing `runWeeklyEpisode` cron cases stay green unchanged, which is the refactor's safety net.
- `podcastWeekSlot.test.ts` (new):
  - `fridayWindow`: move the `inGenerateWindow` boundary cases here (Thursday 23:59 gives ahead, Friday 00:00 and 19:59 give open, Friday 20:00 gives passed, Saturday and Sunday 23:59 give passed, Monday 00:00 gives ahead).
  - `getWeekSlot`: mock prisma. With no row it gives `create`, and it asserts that no `create` or `upsert` call is made. With a row, `fridayRun` comes from the action. The `weekKey` comes from `isoWeekKey`, and the row is looked up by it. A disabled or missing job row gives `automaticRunEnabled: false`.
- `generatePodcast.test.ts`: remove the `inGenerateWindow` describe (its cases moved). The `runGeneratePodcast` "does nothing outside the window" cases still cover the switch. If importing the real `podcastWeekSlot` pulls in too much, mock it partially and keep the real `fridayWindow`.
- `routes/admin/podcasts.test.ts`: `GET /api/admin/podcasts/weekly` returns 401 without auth. With auth it returns 200 with the mocked `getWeekSlot` result (mock `../../services/podcastWeekSlot.js`), and `findOrCreateWeekEpisode` is not called. Assert that it is not swallowed by `/:id` (`getPodcastById` is not called with `'weekly'`).

Client (Vitest + RTL, `ToastProvider` where `useToast` is used):

- `PodcastWeekSlotNotice.test.tsx`: line-2 precedence (job off beats passed, and passed beats `fridayRun`), and the claimed state renders a link to the episode. Pick one case per `fridayRun` only where the branch selection is logic; don't assert every literal.
- `PodcastsPage.test.tsx` (new):
  - Free slot: clicking opens the dialog. Cancel makes no `startWeekly` call. Confirm calls `startWeekly` and navigates.
  - Claimed slot: the button reads "Open this week's episode", navigates to the episode, and calls neither `startWeekly` nor the dialog.
  - Slot query error: clicking opens the dialog.

Run `npm run typecheck --prefix server`, `npm run typecheck --prefix client`, `npm run test --prefix server`, and `npm run test --prefix client -- --run`. Verify visually with Playwright on the running client dev server (do not start it). Close the browser afterwards and clear `.playwright-mcp`.

Landing: commit locally on `main` with a pathspec commit (`git commit -m "…" -- <paths>`), because unrelated untracked `.plans/*-followup.md` files exist. Never push.

## Out of Scope

- Changing the cron's rules themselves, for example making Friday ignore a test-claimed row. The indicator only reports them.
- Showing the slot on the episode detail page or in the Jobs page.
- Treating a `created`, mode-null row specially. Today the cron advances it automated, and the notice says "will continue and finish it", which is accurate.
- The missed-week alert's wording (`podcastMissedWeek.ts`).
- Prisma migrations (none needed) and AI label copy files (untouched).
- OpenAPI: admin endpoints are not in the public spec.

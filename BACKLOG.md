# Backlog

## Code

- Add link to /feedback to newsletter
- Admin logout on every reload in browsers that block third-party cookies (Safari, Brave, strict modes): put the API on `api.actuallyrelevant.news`, then `AUTH_COOKIE_SAMESITE=strict` (owner steps: `.context/authentication.md`, "Cross-site cookie in production"); with it, update `API_URL` in `server/env.example` and the fallback server URL in `server/src/lib/openapi.ts`
- Page-specific og:title/og:description/og:url on /developers and /saved (they inherit the homepage's link preview); limit `article:author` to story pages
- /developers: if the API reference chunk fails, the shared ChunkErrorBoundary fallback adds a second h1 and full-screen "Failed to load page"; give the boundary a `fallback` prop
- `images:info` aborts on `client/public/images/feeds/29cded6e-b5ef-4053-bc5f-d2d10b7238b7.png`, which is really a Windows .ico: convert it to a real PNG, and make `client/scripts/images.mjs` skip an unreadable file instead of aborting the report
- Post-build check that prerendered pages contain real content (e.g. dist/developers has its h1, not the spinner), since unit tests can't see the prerender timing
- Scheduler: claim a database lease in `runJob` for every job (a `lockedUntil` column with an atomic conditional update), since the `runningJobs` overlap guard is per process and two instances overlap during zero-downtime deploys; lease length has to suit long jobs (crawl, assess)
- Scheduler: decide whether a failed run should still write `lastCompletedAt`, or add a separate `lastSucceededAt`
- Scheduler: boot catch-up policy for jobs whose `lastCompletedAt` is null (today they run at boot, e.g. a newly enabled job)
- Scheduler: an environment flag that disables the scheduler, for a second process run against the production database
- Upgrade react-router-dom 6 → 7 (Dependabot 128/129 dismissed as not reachable: BrowserRouter only, no user-controlled `Link`/`navigate` targets). Becomes urgent if any navigation target is ever built from a URL param, query or `location.state`. Move to a data router with it and use `useBlocker`, so browser Back is guarded on admin edit pages with unsaved changes (today only in-app links and tab switches are)
- Newsletter: unique constraint on the automatic issue's week (`newsletters.week_key`, or the title), so two overlapping instances cannot both create the weekly issue
- Scheduler: if a second job needs a fixed time zone, move job time zones from `jobs/jobTimeZones.ts` onto the `job_runs` row, with an editor on the Jobs page
- Check with production logs whether `req.ip` behind Render is the visitor's address (`trust proxy` = 1), since rate limits and logs rely on it
- Split `client/src/layouts/PublicLayout.tsx` into `SiteHeader` and `SiteFooter`, with the links both share in `nav.ts`
- Split the admin-run half of `server/src/services/podcastWeekly.ts` (`startAdminRun`, `resumeEpisode`) into `podcastRuns.ts`
- Split `client/src/components/admin/PodcastStoryFinder.tsx` (filters, results, chosen list) if hybrid search or saved filters arrive
- Podcast: an `eval:recalibrate` fixture for standalone episodes, needed only once the standalone prompt changes
- Podcast: re-voice only the chunks whose text changed after a script edit (today a rewind to `scripted` re-voices the whole episode)
- Podcast: re-tag the MP3's ID3 title after a title edit at `ready`
- Podcast: re-run the configuration check when a podcast job is enabled from the admin Jobs page (today only at boot and at each run)
- Podcast: periodic cleanup of orphaned Bunny objects under `episodes/` (an upload followed by a lost lease or a failed `ready` write leaves one)
- Podcast: saving stories at `selected` after a failed script stage leaves `lastError` set, so the page offers "Resume" instead of "Approve"
- Podcast: the run-progress toast is re-announced in the polite live region on every text change (every chunk while voicing); announce less often
- Admin podcast list (`PodcastTable`) shows "Draft" for an unpublished episode where the detail page says "Unpublished"; align them
- Narrow `CreateContentDialog`'s `type` to newsletters (`'podcast'` is unused)
- Drop the redundant `@@index([token])` on `PendingSubscription` (the `@unique` index covers it) in a migration
- `social_auto_post`: fail and alert when every channel attempt failed (today per-channel errors are only logged)
- Admin job run route (`POST /api/admin/jobs/:jobName/run`): answer 409 when the job is already running (today it says "triggered" and `runJob` skips)
- Remove the dead `server/src/jobs/blueskyAutoPost.ts`
- Scheduler: sequence the boot catch-up jobs (all overdue jobs start at once today)

- Library of static "always true" snippets in the four issue areas that are included randomly (per day) on the frontpage and issue pages
- Compare: relevance stats against SPIEGEL, BBC, etc.

- Public user accounts — Allow users to create accounts, save preferences, follow topics

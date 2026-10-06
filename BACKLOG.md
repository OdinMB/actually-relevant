# Backlog

## Code

- Add link to /feedback to newsletter
- Fix admin logout issue
- Page-specific og:title/og:description/og:url on /developers and /saved (they inherit the homepage's link preview); limit `article:author` to story pages
- /developers: if the API reference chunk fails, the shared ChunkErrorBoundary fallback adds a second h1 and full-screen "Failed to load page"; give the boundary a `fallback` prop
- Post-build check that prerendered pages contain real content (e.g. dist/developers has its h1, not the spinner), since unit tests can't see the prerender timing
- Scheduler: claim a database lease in `runJob` for every job (a `lockedUntil` column with an atomic conditional update), since the `runningJobs` overlap guard is per process and two instances overlap during zero-downtime deploys; lease length has to suit long jobs (crawl, assess)
- Scheduler: decide whether a failed run should still write `lastCompletedAt`, or add a separate `lastSucceededAt`
- Scheduler: boot catch-up policy for jobs whose `lastCompletedAt` is null (today they run at boot, e.g. a newly enabled job)
- Scheduler: an environment flag that disables the scheduler, for a second process run against the production database
- Newsletter: unique constraint on the automatic issue's week (`newsletters.week_key`, or the title), so two overlapping instances cannot both create the weekly issue

- Library of static "always true" snippets in the four issue areas that are included randomly (per day) on the frontpage and issue pages
- Compare: relevance stats against SPIEGEL, BBC, etc.

- Public user accounts — Allow users to create accounts, save preferences, follow topics

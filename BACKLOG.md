# Backlog

## Code

- Add link to /feedback to newsletter
- Page-specific og:title/og:description/og:url on /developers and /saved (they inherit the homepage's link preview); limit `article:author` to story pages
- /developers: if the API reference chunk fails, the shared ChunkErrorBoundary fallback adds a second h1 and full-screen "Failed to load page"; give the boundary a `fallback` prop
- Post-build check that prerendered pages contain real content (e.g. dist/developers has its h1, not the spinner), since unit tests can't see the prerender timing
- Newsletter: unique constraint on the automatic issue's week (`newsletters.week_key`, or the title), so two overlapping instances cannot both create the weekly issue
- Podcast: re-voice only the chunks whose text changed after a script edit (today a rewind to `scripted` re-voices the whole episode)
- Podcast: re-tag the MP3's ID3 title after a title edit at `ready`
- Podcast: periodic cleanup of orphaned Bunny objects under `episodes/` (an upload followed by a lost lease or a failed `ready` write leaves one)
- Feed favicons: `server/src/services/favicon.ts` saves any `image/*` response unchanged as `<id>.png`, which is how seven ICO/BMP files arrived under `client/public/images/feeds/` (converted 2026-10-07); convert to PNG when saving
- Root `errorElement` on the router: a branded error page instead of react-router's default "Unexpected Application Error" screen
- Move imports from `react-router-dom` to `react-router` (about 60 files) before react-router v8 drops the re-export
- Podcast: freeze the spoken opener and sign-off per episode before their wording next changes, so older transcript pages keep the words their audio used (today `publicTranscript` takes the current wording from `aiLabelCopy.ts`)
- Newsletter freshness: before an issue goes out, check whether a selected story has been overtaken by later events (e.g. "US orders total blockade of key oil route" became "US orders blockade of Iranian ports" days later). Options range from a warning for the editor (newer stories in the same dedup cluster, or a newer headline from the same source) to an LLM check of each pick against stories crawled since. Reader feedback, October 2026
- Paywalled stories, phase 2: after about four weeks of `accessTier` data (from the deploy of the crawl-time paywall rejection), decide on the newsletter short-content filter (E1) and the small-model sufficiency check (E2) for `unknown`/API-path stories, and adjust feed paywall settings; run `npm run scan:teasers` again for the review. Plan `.plans/completed/2026-10-08_paywalled-stories.md`
- Add `buildFilter.paths` to both services in `render.yaml`, covering each service's directory plus `shared/**` and `scripts/**`: with a root directory set, Render auto-deploys a service only for changes inside it, so a change confined to `shared/` or `scripts/install-dev-deps.mjs` redeploys neither service
- Move the backend to a Docker image behind CI (hybrid): one pinned-base image built and smoke-tested in CI, deployed with `autoDeployTrigger: checksPass` (semantics-fun's model), so a commit is tested before it deploys and the runtime is pinned. The static site stays a Render static site: merging it into the server would take the site down with the backend, put cron/LLM/ffmpeg work beside page serving on a memory-capped instance, and lose the CDN. Costs: base-image patching becomes manual; the image needs ffmpeg and Prisma's Linux binary targets; a flaky CI blocks deploys; Render Shell operator commands in the docs need rewriting.
- Feedback retention: delete feedback rows (message, optional email, keyed `ip_hash`) after a set period, e.g. 12 months, as a scheduled job, and add a feedback line to the privacy page's "Your Rights" (owner approves the period and copy). Today feedback is kept indefinitely
- Set `WEBHOOK_URL` in production (e.g. a Slack or Discord channel) so owner alerts also reach a chat, including those raised while the database is down, which today are lost because the admin Notices page stores them in the database. Then move it from the blueprint test's `NOT_SET_IN_PRODUCTION` list into `render.yaml` as `sync: false`

## Podcast registration (owner)

Wait until the first episode has been generated automatically and successfully (`generate_podcast` enabled, Friday run), then submit the feed `https://actuallyrelevant.news/podcast.xml`. Afterwards, send the listing URLs so "Listen on…" links can go on `/podcast` (`config.podcast.listenLinks`).

- Spotify: creators.spotify.com → "Add your podcast" → "Find an existing show" / "Somewhere else"; verification code goes to contact@actuallyrelevant.news
- Podcast Index (podcastindex.org/add, no account) and Amazon Music for Podcasters (podcasters.amazon.com)

## Ideas

- Announce each published podcast episode and newsletter issue on Bluesky and Mastodon. Owner, 2026-10-25: build it after the two social services are merged into one channel abstraction, since social posts are keyed to stories today and need a schema change (`/mnt/project-files/codebase-scans/2026-10-25_find-opps.md`, item 4)
- Signed C2PA Content Credentials on generated images (`og.png`, carousel). Parked by the owner 2026-10-25: a self-signed certificate shows "unrecognized signer", a trusted one costs money and renewal

- Library of static "always true" snippets in the four issue areas that are included randomly (per day) on the frontpage and issue pages
- Compare: relevance stats against SPIEGEL, BBC, etc.

- Public user accounts — Allow users to create accounts, save preferences, follow topics

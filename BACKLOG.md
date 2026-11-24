# Backlog

## Code

- Add link to /feedback to newsletter
- Post-build check that prerendered pages contain real content (e.g. dist/developers has its h1, not the spinner), since unit tests can't see the prerender timing
- Newsletter: unique constraint on the automatic issue's week (`newsletters.week_key`, or the title), so two overlapping instances cannot both create the weekly issue
- Podcast: re-voice only the chunks whose text changed after a script edit (today a rewind to `scripted` re-voices the whole episode)
- Podcast: re-tag the MP3's ID3 title after a title edit at `ready`
- Podcast: periodic cleanup of orphaned Bunny objects under `episodes/` (an upload followed by a lost lease or a failed `ready` write leaves one)
- Move imports from `react-router-dom` to `react-router` (about 60 files) before react-router v8 drops the re-export
- Podcast: freeze the spoken opener and sign-off per episode before their wording next changes, so older transcript pages keep the words their audio used (today `publicTranscript` takes the current wording from `aiLabelCopy.ts`)
- Newsletter freshness, model check: an LLM check of each pick against the stories crawled since, for the follow-ups that `services/storyFreshness.ts` misses (it drives the issue page's flags, from a later story in the same dedup cluster or a nearly identical later headline from the same feed, and selection's swaps, from the cluster alone). The dedup prompt keeps "a different development of the same ongoing story" out of a cluster, so a follow-up such as "US orders total blockade of key oil route" becoming "US orders blockade of Iranian ports" days later is flagged only if dedup clustered the two
- Paywalled stories, phase 2: after about four weeks of `accessTier` data (from the deploy of the crawl-time paywall rejection), decide on the newsletter short-content filter (E1) and the small-model sufficiency check (E2) for `unknown`/API-path stories, and adjust feed paywall settings; run `npm run scan:teasers` again for the review. Plan `.plans/completed/2026-10-08_paywalled-stories.md`
- Move the backend to a Docker image behind CI (hybrid): one pinned-base image built and smoke-tested in CI, deployed once CI passes (semantics-fun's model; here CI's deploy job would call the hook with `imgURL` instead of `ref`, ADR-0054), so a commit is tested before it deploys and the runtime is pinned. The static site stays a Render static site: merging it into the server would take the site down with the backend, put cron/LLM/ffmpeg work beside page serving on a memory-capped instance, and lose the CDN. Costs: base-image patching becomes manual; the image needs ffmpeg and Prisma's Linux binary targets; a flaky CI blocks deploys; Render Shell operator commands in the docs need rewriting.
- Feedback retention: delete feedback rows (message, optional email, keyed `ip_hash`) after a set period, e.g. 12 months, as a scheduled job, and add a feedback line to the privacy page's "Your Rights" (owner approves the period and copy). Today feedback is kept indefinitely
- Set `WEBHOOK_URL` in production (e.g. a Slack or Discord channel) so owner alerts also reach a chat, including those raised while the database is down, which today are lost because the admin Notices page stores them in the database. Then move it from the blueprint test's `NOT_SET_IN_PRODUCTION` list into `render.yaml` as `sync: false`
- Report-an-error form: use the signup form's token refresh (one shared piece for both forms), so a report sent from a long-open or backgrounded tab isn't silently dropped (the signup token refresh landed 2026-10-28)
- Confirmed-subscription page links to the latest newsletter issue and the podcast instead of "explore today's stories"
- Research facts drift from their sources when a fact carries a figure (found 2026-11-24 in the overviews' stands eval, where a summary line that repeats its fact rightly passes; this is research's own step, to be checked by research's own eval). A fact with a figure is shown to writers and to checks from its structured fields, not its statement (`renderFact`), and the fields lose what the statement kept: a proposal becomes a share in force, "11 countries, including five named" becomes the five, a period given as "2023-2024" is no valid as-of and is dropped, the provisional flag reads "(estimate)", the outlet's or speaker's credit lands on the wrong body, and a figure is invented where the source has none ("1 series of actions"). Of 22 summary lines a judge reading the source sentence rejected, three readers found 12 faithful to a fact that misstates its source (10 misleading for a reader), 8 fine, 2 the summary writer's own. First part done 2026-11-24: `structured()` drops a number with neither unit nor thing counted and a range end not above its start. Open: show the statement beside the fields or instead of them, keep a period as-of, stop invented counts, and measure with `eval:research` and `eval:overviews --steps context`. Line by line: `DOCS/2026-11-24_research-fact-drift-lines.json` on the owner's machine

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

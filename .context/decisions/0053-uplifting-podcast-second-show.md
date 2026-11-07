---
id: ADR-0053
title: Make the Actually Uplifting podcast a second show in the podcasts table, told apart by edition, with its own feed /podcast-uplifting.xml and channel GUID, opened by PODCAST_UPLIFTING_ENABLED once the owner has confirmed its description and supplied its artwork
status: accepted
date: 2026-11-07
deciders: ["claude-code (AI)"]
context-repo: OdinMB/actually-relevant
themes: [architecture]
tags: ["podcast", "uplifting", "feed"]
---

# ADR-0053 · Make the Actually Uplifting podcast a second show in the podcasts table, told apart by edition, with its own feed /podcast-uplifting.xml and channel GUID, opened by PODCAST_UPLIFTING_ENABLED once the owner has confirmed its description and supplied its artwork

## Context

The newsletter has two editions (ADR-0052). The podcast gets a second show too: a weekly five-minute episode made from that week's uplifting stories only. The owner wants it built now but switched on later, after watching uptake: "only activate the podcast [after uptake]... The functionality should already be there, though."

The main show's on/off is two job rows. Rows can stop the automatic runs, but they cannot hide a public feed or page, and they cannot stop a person from publishing by hand.

Two identities become permanent the moment a podcast directory takes a feed: its URL and its channel `podcast:guid`.

## Decision

- **One table, a show column.** `podcasts.edition` (`full | uplifting`, default `full`) names the show. It is a third axis beside `kind` (`weekly | standalone`), never folded into it. The week key is unique per show (`@@unique([edition, weekKey])`). A CHECK (`podcasts_standalone_full_edition`) keeps standalone episodes on the main show. The missed-week alert is claimed per show: `podcast_missed_week_alerts` has the primary key `(edition, week_key)`.
- **One module for what differs.** `services/podcastEdition.ts` holds, for each show, its title, description, page, feed path, channel GUID, artwork, listen links, two jobs, the name its notices use, storage prefix and show-notes line. It also holds whether the uplifting show is open.
- **Its own feed and identity.** The feed is `/podcast-uplifting.xml`, a Render rewrite to `GET /api/podcast/uplifting/feed.xml`. A path, not `?edition=`, because a feed URL is a permanent identity in directories. The channel `podcast:guid` is `d9c75d86-b104-5e90-9439-fec127edf1c0`: the UUIDv5 of `actuallyrelevant.news/podcast-uplifting.xml` in the Podcasting 2.0 namespace, pinned by a test. Item GUIDs are row ids, as on the main show. The page is `/podcast/uplifting`.
- **One switch with named preconditions.** The env var `PODCAST_UPLIFTING_ENABLED` on the API service is parsed strictly, so a typo refuses to start. The show is open only when the variable is `true` **and** two code-side preconditions hold:
  - `PODCAST_UPLIFTING_COPY_CONFIRMED` is true: the show description is new AI-statement wording and needs the owner's confirmation;
  - `config.podcast.uplifting.artworkUrl` is set: Apple requires artwork.

  `upliftingShowProblem()` names whatever is missing. Every gate asks `isEditionOpen` through it.
- **What closed means.**
  - Public reads 404: the feed, `GET /api/podcast?edition=uplifting` and the page, which says "Page not found" with `noindex`. `publishedWhere()` admits only open shows, so no uplifting episode reaches a transcript page, a story card or the sitemap.
  - Nothing spends: a live voicing is blocked before any balance check or TTS call, publishing is refused, and the admin can create or start an uplifting week episode only as a dry run with the variable set.
  - Both jobs are seeded disabled, and enabling either is refused (422) while the show is closed. A job enabled before the show was closed again is a logged no-op.

## Consequences

- Deploying changes nothing anyone sees. The rewrite proxies to a 404 at an address nothing links.
- Switching on is the owner's: confirm the description, supply the artwork, raise the shared TTS cap, set the variable, publish a first episode by hand, submit the feed to the directories, then enable the jobs (`.context/podcast.md`, "Actually Uplifting show").
- Switching off again is unsetting the variable. Pages and feed disappear at once; published files stay on the CDN, as after an unpublish.
- The feed URL and channel GUID must never change once a directory has the feed. Changing either would orphan every subscriber in every app.
- `config.podcast` gains its first env-derived value. Switching on is the owner's own act, and a dashboard flip he can undo at once fits that better than a deploy. The wording and artwork gates stay in code, since an approval of wording is a code change anyway.
- The monthly TTS cap stays shared and sized for one show. Nothing spends while closed. Raising the cap is an owner step at switch-on.

## Alternatives considered

- **A third `kind` value `uplifting`.** It would reuse the per-kind wording records for free. But it fuses "which show" with "which format", breaks every `kind === 'weekly'` rule (the generate job, the auto-publish candidate, the missed-week alert), and blocks a later uplifting standalone.
- **A separate `uplifting_podcasts` table.** It duplicates the stage machine, the lease and every query.
- **Reusing the Postgres enum `NewsletterEdition`.** That enum is ADR-0052's and documented as the newsletter's. A two-value enum is cheap to duplicate and lets the two products change apart.
- **Job rows as the only switch**, as for the main show. They cannot hide a public feed or page, and the admin could still publish by hand.
- **A code constant as the switch.** It would need a deploy to switch on and off. Switching on is the owner's call after watching uptake.
- **`/podcast.xml?edition=uplifting` as the feed URL.** Directories key a show on its feed URL. A query string is easy to lose in a copy and harder to rewrite on Render.

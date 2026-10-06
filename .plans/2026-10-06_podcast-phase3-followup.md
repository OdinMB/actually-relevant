# Podcast Phase 3 (publishing): follow-up

Run: Phase 3 of `.plans/autonomous-two-speaker-podcast.md`, resumed after a crashed first run whose uncommitted server work (migration, publish/feed/show services, public route, admin routes, OpenAPI, sitemap, config) was reviewed and kept.

## Controversial Decisions

- **ADR-0006 left as a stub.** Its decision includes "automatic publishing is a job toggle" (`publish_podcast`), which Phase 4 builds. The publication/production split it also states is in force (and has been since Phase 1), but promoting half a decision would record a toggle that does not exist. Promote it with Phase 4; its id will give way (the log is at ADR-0010).
- **Publish takes the episode's lease**, so Publish answers 409 while a run or an edit holds it. Alternative: no lease (simpler) but a publish could interleave with a rewind's fenced writes.
- **"Edited by a person" stays editable after publication** (the title does not). It only changes the disclosure line, never the audio or GUID, and the feed cache is invalidated. The ID3 comment inside an already assembled MP3 keeps its original line.
- **Republish keeps the first `publishedAt`**, so podcast apps keep the item's date; the alternative (a fresh date) would bump it to the top as if new.
- **Feed extras beyond the plan:** RSS `<image>`, `itunes:title`, `itunes:episodeType`, `copyright`, `lastBuildDate`. All standard; Apple and Spotify accept them.
- **Privacy wording** (draft, owner to review): Bunny row says "IP address and user agent when you play or download a podcast episode, its transcript, or the show artwork, including through a podcast app. BunnyWay d.o.o. (Slovenia, EU) stores the files in Germany, delivers them from the server nearest to you, and processes this data on our behalf. IP addresses are anonymized in its logs." ElevenLabs row: "No visitor data. We send only the episode script, which is written from published news." The self-hosting paragraph adds "The one exception is podcast audio: on the podcast page, an episode loads from Bunny.net only when you press play." The anonymization sentence relies on the pull-zone setting from the owner's Bunny setup; confirm it is on.
- **Edited AI line held back until the owner confirms it** (Phase 3 compliance review fix): the relayed approval is not the owner's own words, so `PODCAST_EPISODE_AI_LINE_EDITED_CONFIRMED` (false) in `aiLabelCopy.ts` makes the server refuse (409) publishing an episode marked "Edited by a person" and ticking the flag on a listed one. Chosen over an admin-only warning because the Phase 4 auto-publish job would bypass a warning. The refusal reaches the admin as the publish error toast; no separate pre-warning in the UI.

## Decisions to Review

None new without a person: ADR-0010 names Odin Mühlenbein (the decision is his, and the plan's confirmation line covers it) beside the agent. ADR-0008 and ADR-0009 remain unreviewed (review optional), as recorded in the Phase 2b follow-up.

## Records to Refresh

None: the repository keeps no `records` files (personal-data note, data inventory, model cards). The privacy notice and `.context/ai-transparency.md` were updated in the change itself.

## User Input Needed

- **Owner approvals arrived relayed, not in the owner's own words in this session**: the edited-episode AI line and the artwork. The line is now recorded as pending in `aiLabelCopy.ts`, `.context/ai-transparency.md` (§3 row 8, §7, §11) and the plan. To confirm it: set `PODCAST_EPISODE_AI_LINE_EDITED_CONFIRMED` to true with the date and mark the record approved.
- **Privacy notice wording** (above): owner review before deploy.

## DB Migrations

- `server/prisma/migrations/20261006220000_podcast_publish/migration.sql` (adds `published_at`, `unpublished_at`; backfills `published_at` for non-legacy rows already `published`). Applies when the owner restarts the server dev process (`predev` runs `db:prepare`) and on deploy. The server typecheck already passes, so the Prisma client in this checkout knows the columns.

## Implementation Issues

- **No sub-agent tool** in this run: the check battery ran inline (output filtered to failures and totals) and the code review was a self-review, not the three `feature-dev:code-reviewer` passes the plan's complexity asks for.
- **Guard mutation check refused**: disabling the dry-run publish guard to watch its test go red was refused by the permission classifier. The test's fixture does carry `dryRun: true` and asserts the refusal and that nothing was written, but the red run was not observed.
- Not checked in a browser: the admin Publish flow and `/podcast` are covered by rendering tests and the prerendered HTML (heading, label, feed link present in `client/dist/podcast/index.html`).

## Suggested Follow-Up Work

- `PodcastTable` (admin list) shows "Draft" for an unpublished episode; the detail page says "Unpublished". Cheap to align (it has `publishedAt` now).
- After the first publish: validate the live feed and run the transparency record's §11 live checks.
- Phase 4 auto-publish: while the edited AI line is unconfirmed, `pickAutoPublishCandidate` should skip `humanEdited` episodes (or the job reports the refusal), or the job would fail on such an episode each run.
- Optional: show the "awaits the owner's confirmation" note beside the Publish button for an edited episode instead of only as the 409 toast.

## Mod code and load settings written

None.

## Landing Queue

- repo `OdinMB/actually-relevant`, branch `main` (local commits), base `main`: push only, on the owner's word. No pull-request case applies from this session's rule index (REPO-004/006 not switched on; no Ashoka status line); remote protection: check at landing. Note `main` also carries earlier unpushed commits.

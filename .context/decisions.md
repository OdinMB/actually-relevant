# Decision log

The repository's architectural decisions, oldest first. Each decision lives in its own file under
`.context/decisions/`; this index lists them by title. Unlike the rest of `.context/`, the log is a
historical record: entries are appended and never rewritten. An accepted entry that no longer holds
is superseded by a later one, and both stay, the older one marked as superseded.

To add one: take the next free id, counting the ids listed here and the stub ids in every plan
under `.plans/` and `.plans/completed/` (which is why an id can be missing from this list); create
its file, `.context/decisions/NNNN-<short-slug>.md`; and add its line at the bottom of this list.

- [ADR-0003 · Produce episodes as a stage machine on the Podcast row, fenced by a DB lease, with TTS chunks in Postgres until upload](decisions/0003-podcast-stage-machine-and-lease.md)
- [ADR-0005 · Assemble, loudness-normalise and tag episode MP3s with a pinned ffmpeg-static binary](decisions/0005-ffmpeg-static-episode-assembly.md)
- [ADR-0007 · Voice episodes with ElevenLabs eleven_v4 Text to Dialogue through a thin axios client](decisions/0007-elevenlabs-text-to-dialogue-client.md)
- [ADR-0008 · Pause interactive episodes for review through a per-row mode, a selected stage and explicit admin rewinds](decisions/0008-podcast-review-modes-and-rewinds.md)
- [ADR-0009 · Track podcast runs from the episode lease in an app-level admin provider that drives a persistent, clickable toast](decisions/0009-podcast-run-progress-from-the-lease.md)
- [ADR-0010 · Self-host podcast audio on Bunny Storage and CDN and serve the podcast feed from Express](decisions/0010-self-host-podcast-audio-and-feed.md)
- [ADR-0011 · Retry the weekly episode at repeated weekend cron slots guarded in podcast code, not in the shared scheduler](decisions/0011-weekend-cron-slots-for-podcast-retries.md) — superseded by ADR-0013
- [ADR-0012 · Keep publication (status) separate from production (stage) and make automatic publishing a job toggle](decisions/0012-podcast-publication-separate-from-production.md) — superseded by ADR-0013
- [ADR-0013 · Generate the weekly episode at guarded Friday slots and auto-publish it Saturday 07:00 Berlin, apart from production](decisions/0013-friday-generation-saturday-berlin-publication.md)
- [ADR-0014 · Accept a just-rotated refresh token for 60 seconds instead of revoking its session, and rotate atomically](decisions/0014-refresh-token-reuse-grace-window.md)
- [ADR-0015 · A person performs the selection stage of a standalone episode; the AI suggestion is advisory and writes nothing](decisions/0015-person-performs-standalone-selection-stage.md)
- [ADR-0016 · Mark an episode's kind in an explicit kind column, weekly or standalone, with standalone rows never carrying a week key](decisions/0016-podcast-kind-column.md)
- [ADR-0017 · Fence every job run with a heartbeat-renewed lease on its job_runs row, claimed atomically on the database clock](decisions/0017-job-run-lease.md) — superseded by ADR-0020
- [ADR-0018 · Route the client through react-router 7's data router, built from a route tree App.tsx exports](decisions/0018-react-router-7-data-router.md)
- [ADR-0019 · Name api.actuallyrelevant.news as the API's public host, keeping the onrender.com host answering](decisions/0019-api-host-api-actuallyrelevant-news.md)
- [ADR-0020 · Hold the job-run lease for 2 minutes and renew it every 30 seconds, both overridable, as ADR-0017 otherwise](decisions/0020-job-lease-two-minutes-renewed-every-30-seconds.md)

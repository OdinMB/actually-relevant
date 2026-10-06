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

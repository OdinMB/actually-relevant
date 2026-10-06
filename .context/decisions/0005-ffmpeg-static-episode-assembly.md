---
id: ADR-0005
title: Assemble, loudness-normalise and tag episode MP3s with a pinned ffmpeg-static binary
status: accepted
date: 2026-10-06
deciders: ["claude-code (AI)", "Odin Mühlenbein"]
context-repo: OdinMB/actually-relevant
themes: ["vendor"]
---

# ADR-0005 · Assemble, loudness-normalise and tag episode MP3s with a pinned ffmpeg-static binary

## Context

The weekly two-speaker podcast (plan `.plans/autonomous-two-speaker-podcast.md`) is voiced in
about five text-to-speech requests, one per story segment, each returning its own MP3. A listener
must hear one file with even loudness, a short deliberate pause between stories (Phase 0 S1: the
next story started too abruptly without one), and the file must carry machine-readable
AI-provenance marks for the EU AI Act record (`.context/ai-transparency.md`). There is no standard
ID3 frame for the IPTC digital source type.

The backend runs on Render's native Node runtime, which has no system ffmpeg, on an instance with
512 MiB of memory shared with the API. Before committing to ffmpeg, the plan required a spike
(S5) on Render itself: a 5-minute join with loudness normalisation took 16.5 s with a 73 MB peak
for ffmpeg, using `ffmpeg-static` 5.3.0, whose install script downloads a static binary (about
76 MB on Linux) at `npm install`.

## Decision

We add `ffmpeg-static` at an exact version and run one ffmpeg process per episode on temp files in
`os.tmpdir()`, which are always removed: each chunk is padded with the configured pause except the
last, the chunks are concatenated, loudness-normalised to -16 LUFS, re-encoded to 128 kbps CBR mono
MP3, and tagged with ID3v2.3 title, artist, album and comment plus `TXXX` frames `AI-generated=true`
and `digitalSourceType=…/trainedAlgorithmicMedia`. The same binary generates silence for the
dry-run stub voice. Duration is computed from the CBR byte count, so no ffprobe is needed.
`server/src/lib/podcastAudio.ts` is the only place that spawns it.

## Consequences

Episodes sound even across chunk joins, the pause between stories is a setting
(`config.podcast.segmentPauseMs`), and the provenance frames are written by the same step that
produces the file, so no episode can leave without them. The integration test runs the real binary
and reads the frames back.

What got worse: every backend build downloads a ~76 MB binary from GitHub at install time, a build
that skips install scripts produces a server that cannot reach `ready`, and the binary's version
moves only when someone bumps the pin. The ID3 marks are unsigned and lost on any re-encode by a
directory or player. `loudnorm` cannot process pure digital silence (it yields samples that crash
the MP3 encoder), so the dry run assembles its silent stub without it and does not exercise that
filter; this was found at implementation.

Revisit if the binary download starts failing on Render (then `@ffmpeg-installer/ffmpeg`, which
ships the binary inside the npm tarball), if assembly approaches the instance's memory as episodes
grow, or if signed provenance (C2PA for audio) becomes available to us.

## Alternatives considered

- **Raw MP3 frame concatenation plus a small ID3 writer, without ffmpeg** — no loudness
  normalisation and possible clicks at the joins; it stays the fallback if ffmpeg becomes unusable
  on the host.
- **`@ffmpeg-installer/ffmpeg`** — the binary ships inside the npm package, so no install-time
  download; not needed once the spike showed the `ffmpeg-static` download works on Render.
- **The concat demuxer with a generated silence file** (what the spike used) — needs a silence file
  matching the chunks' format and an escaped list file; a `filter_complex` with `apad` and
  `concat` does the same in one argument list.
- **A hosted audio service** — another vendor receiving the episode for a step a local binary does
  in seconds.

---
id: ADR-0010
title: Self-host podcast audio on Bunny Storage and CDN and serve the podcast feed from Express
status: accepted
date: 2026-10-06
deciders: ["Odin Mühlenbein", "claude-code (AI)"]
context-repo: OdinMB/actually-relevant
themes: ["vendor", "cost", "personal-data", "ai-risk"]
---

# ADR-0010 · Self-host podcast audio on Bunny Storage and CDN and serve the podcast feed from Express

## Context

The weekly two-speaker podcast (plan `.plans/autonomous-two-speaker-podcast.md`) produces one MP3
of about 5 to 6.5 minutes and a VTT transcript per week. Until then episodes were voiced by hand and
uploaded to Buzzsprout, whose feed the project did not control. The owner wanted every feed to say
that the show is AI-written and AI-voiced in machine-readable form (`podcast:txt` ai-content on the
channel and on every item), a transcript per episode, stable episode identities, hosting in the EU,
and publishing that could later run without a person.

The site runs on Render: a static site for the client and a web service for the API, with about
5 GB of outbound bandwidth a month included. Streaming audio through the API would spend that
allowance. The API's own hostname, `api.actuallyrelevant.news`, did not resolve on 2026-09-25, while
the static site already proxies `/sitemap.xml` to the API through a Render rewrite. Phase 0 (S4,
2026-10-06) showed that Bunny serves uploads under a custom hostname with byte ranges and correct
content types, and that its CDN keeps a deleted file cached for up to 30 days. Listeners who play an
episode send their IP address to whoever serves the file.

## Decision

We upload each episode's MP3 and VTT to a Bunny Storage zone in Frankfurt and serve them through a
Bunny pull zone on the custom hostname `https://audio.actuallyrelevant.news`; Render never carries
audio. Express builds the podcast RSS feed by hand (`server/src/services/podcastFeed.ts`) with the
`itunes`, `podcast`, `atom` and `content` namespaces, served at `GET /api/podcast/feed.xml` and
published at `https://actuallyrelevant.news/podcast.xml` through a Render rewrite. The feed's item
GUID is the episode row's id, its enclosure is the CDN URL with the exact byte length, and an
episode's file name is never reused (a fresh random suffix per render): once an episode is published,
its GUID and enclosure URL never change. Choosing Bunny and our own Express feed is the owner's
decision; the GUID, the path permanence and the rewrite are the agent's details within it.

## Consequences

The feed carries the AI markers, the transcript and the show's identity as we choose, and moving to
another directory or host later needs no migration from a third party. Audio costs Bunny's per-GB
price instead of Render bandwidth, and the files stay in the EU at rest. Stable GUIDs and URLs mean
apps never see a re-published episode as new.

What got worse: we own feed validity against Apple's and Spotify's requirements, which change, with
no hosting service to absorb them; the feed and the public page depend on a Render rewrite that must
sit above the SPA catch-all, a manual setting outside the repository. Listeners' IP addresses reach
Bunny (a processor named in the privacy notice). Unpublishing removes an episode from the feed and
the page, but its files stay reachable on the CDN until someone purges them by hand (owner decision:
no automatic purge), and apps keep downloaded copies. A file name, once used, is spent.

Revisit if Bunny's terms, price or EU storage change, if a directory requires something a hand-built
feed cannot easily give (for example signed or dynamic ad insertion), if the show grows beyond one
weekly feed, or if the API gets a working public hostname of its own.

## Alternatives considered

- **Buzzsprout or Transistor** (keep a hosting service) — no control over `podcast:txt`, the
  transcript tag or the GUIDs, and a second place where episodes and their AI disclosure live.
- **Cloudflare R2 behind a CDN** — also self-hosting; the owner chose Bunny (EU company, storage in
  Frankfurt), and Bunny passed the S4 checks, so R2 was not tested.
- **Serving the MP3 from Render** — spends the web service's bandwidth on every play and download.
- **The `feed` npm package** (as the story RSS uses) — no `itunes` or Podcasting 2.0 support;
  building the XML by hand is smaller than post-processing its output.
- **Publishing the feed on the API host** — `api.actuallyrelevant.news` did not resolve; the
  rewrite gives a permanent URL on the main domain instead.

# Backlog

## Code

- Add link to /feedback to newsletter
- Admin logout on every reload in browsers that block third-party cookies (Safari, Brave, strict modes): put the API on `api.actuallyrelevant.news`, then `AUTH_COOKIE_SAMESITE=strict` (owner steps: `.context/authentication.md`, "Cross-site cookie in production"); with it, update `API_URL` in `server/env.example` and the fallback server URL in `server/src/lib/openapi.ts`
- Page-specific og:title/og:description/og:url on /developers and /saved (they inherit the homepage's link preview); limit `article:author` to story pages
- /developers: if the API reference chunk fails, the shared ChunkErrorBoundary fallback adds a second h1 and full-screen "Failed to load page"; give the boundary a `fallback` prop
- Post-build check that prerendered pages contain real content (e.g. dist/developers has its h1, not the spinner), since unit tests can't see the prerender timing
- Upgrade react-router-dom 6 → 7 (Dependabot 128/129 dismissed as not reachable: BrowserRouter only, no user-controlled `Link`/`navigate` targets). Becomes urgent if any navigation target is ever built from a URL param, query or `location.state`. Move to a data router with it and use `useBlocker`, so browser Back is guarded on admin edit pages with unsaved changes (today only in-app links and tab switches are)
- Newsletter: unique constraint on the automatic issue's week (`newsletters.week_key`, or the title), so two overlapping instances cannot both create the weekly issue
- Check with production logs whether `req.ip` behind Render is the visitor's address (`trust proxy` = 1), since rate limits and logs rely on it
- Podcast: re-voice only the chunks whose text changed after a script edit (today a rewind to `scripted` re-voices the whole episode)
- Podcast: re-tag the MP3's ID3 title after a title edit at `ready`
- Podcast: periodic cleanup of orphaned Bunny objects under `episodes/` (an upload followed by a lost lease or a failed `ready` write leaves one)
- Feed favicons: `server/src/services/favicon.ts` saves any `image/*` response unchanged as `<id>.png`, which is how seven ICO/BMP files arrived under `client/public/images/feeds/` (converted 2026-10-07); convert to PNG when saving

- Library of static "always true" snippets in the four issue areas that are included randomly (per day) on the frontpage and issue pages
- Compare: relevance stats against SPIEGEL, BBC, etc.

- Public user accounts — Allow users to create accounts, save preferences, follow topics

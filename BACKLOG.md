# Backlog

## Code

- Add link to /feedback to newsletter
- Admin logout on every reload in browsers that block third-party cookies (Safari, Brave, strict modes); the API answers at `api.actuallyrelevant.news` since 2026-10-07. Owner steps left (`.context/authentication.md`, "Cross-site cookie in production"): set `VITE_API_URL=https://api.actuallyrelevant.news` on the static site and redeploy (everyone logs in once more); check `API_URL` on the API service (set it to the new host or unset it, so the OpenAPI docs name it); once the admin works on the new host, set `AUTH_COOKIE_SAMESITE=strict` on the API service
- Page-specific og:title/og:description/og:url on /developers and /saved (they inherit the homepage's link preview); limit `article:author` to story pages
- /developers: if the API reference chunk fails, the shared ChunkErrorBoundary fallback adds a second h1 and full-screen "Failed to load page"; give the boundary a `fallback` prop
- Post-build check that prerendered pages contain real content (e.g. dist/developers has its h1, not the spinner), since unit tests can't see the prerender timing
- Newsletter: unique constraint on the automatic issue's week (`newsletters.week_key`, or the title), so two overlapping instances cannot both create the weekly issue
- Check with production logs whether `req.ip` behind Render is the visitor's address (`trust proxy` = 1), since rate limits and logs rely on it
- Podcast: re-voice only the chunks whose text changed after a script edit (today a rewind to `scripted` re-voices the whole episode)
- Podcast: re-tag the MP3's ID3 title after a title edit at `ready`
- Podcast: periodic cleanup of orphaned Bunny objects under `episodes/` (an upload followed by a lost lease or a failed `ready` write leaves one)
- Feed favicons: `server/src/services/favicon.ts` saves any `image/*` response unchanged as `<id>.png`, which is how seven ICO/BMP files arrived under `client/public/images/feeds/` (converted 2026-10-07); convert to PNG when saving
- Root `errorElement` on the router: a branded error page instead of react-router's default "Unexpected Application Error" screen
- Move imports from `react-router-dom` to `react-router` (about 60 files) before react-router v8 drops the re-export
- Podcast: freeze the spoken opener and sign-off per episode before their wording next changes, so older transcript pages keep the words their audio used (today `publicTranscript` takes the current wording from `aiLabelCopy.ts`)

- Library of static "always true" snippets in the four issue areas that are included randomly (per day) on the frontpage and issue pages
- Compare: relevance stats against SPIEGEL, BBC, etc.

- Public user accounts — Allow users to create accounts, save preferences, follow topics

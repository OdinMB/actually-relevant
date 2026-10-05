# Backlog

## Code

- Add link to /feedback to newsletter
- Fix admin logout issue
- Rename the dotted variable templates (`server/.env.sample`, `client/.env.sample`) to `env.example` so agents can read and maintain them, then document `SKIP_DB_PREPARE` and the local Docker `DATABASE_URL` in the server one
- Page-specific og:title/og:description/og:url on /developers and /saved (they inherit the homepage's link preview); limit `article:author` to story pages
- /developers: if the API reference chunk fails, the shared ChunkErrorBoundary fallback adds a second h1 and full-screen "Failed to load page"; give the boundary a `fallback` prop
- Post-build check that prerendered pages contain real content (e.g. dist/developers has its h1, not the spinner), since unit tests can't see the prerender timing

- Library of static "always true" snippets in the four issue areas that are included randomly (per day) on the frontpage and issue pages
- Compare: relevance stats against SPIEGEL, BBC, etc.

- Public user accounts — Allow users to create accounts, save preferences, follow topics

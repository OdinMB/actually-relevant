# UI Conventions

Standards and patterns for building public and admin pages.

## SEO Checklist

Each page should:

- [ ] Use Helmet with title, description
- [ ] Have unique, descriptive title
- [ ] Have unique meta description (150-160 chars)
- [ ] Be listed in `shared/routes.json` for prerendering and the sitemap (`.context/seo.md`)
- [ ] Render JSON-LD through `<StructuredData>` or, inside Helmet, `toJsonLd()` (`client/src/lib/structured-data.ts`), never plain `JSON.stringify`: story and episode text comes from crawled pages, and an unescaped `</script>` would break out of the element in prerendered HTML
- [ ] No hardcoded counts (source count, story count, language count) -- use `useSources()` hook or omit. These values change as feeds are added/removed.

## CSS Utility Classes

Defined in `client/src/index.css`:

**Layout:**

- `.page-section` -- Standard page wrapper (max-w-3xl, responsive padding)
- `.page-section-wide` -- Wider page wrapper (max-w-4xl)

**Typography:**

- `.page-title` -- Page headings (text-4xl/5xl, bold, centered)
- `.page-intro` -- Subtitle text below page title
- `.prose` -- Body text container (text-neutral-600, relaxed leading, auto-styled links)
- `.section-heading` -- Section headings (text-2xl)
- `.section-heading-lg` -- Larger section headings (text-3xl)

## Public URLs

The site URL and the Ko-fi, Bluesky, Mastodon and GitHub addresses are constants in `client/src/config.ts` (`SITE_URL`, `KOFI_URL`, `BLUESKY_PROFILE_URL`, `MASTODON_PROFILE_URL`, `GITHUB_REPO_URL`); `SEO.siteUrl` is `SITE_URL`. Import them rather than writing an address inline. `index.html` and the build scripts in `client/scripts/` cannot import them and keep their own copies, as does the server's newsletter email template (`config.links` in `server/src/config.ts`).

## Bundle Splitting

The client uses `React.lazy()` to split code and reduce initial bundle size. Homepage visitors only download homepage code; other pages load on demand.

**Rules:**

- **HomePage** (`client/src/pages/HomePage.tsx`): Static import in `App.tsx` -- this is the critical landing page
- **Other public pages** (`client/src/pages/*.tsx`): Use **`React.lazy()`** in `App.tsx`, wrapped in `LazyPage` -- prerendering waits for the chunk because the route fallback carries `routeFallbackProps` (`client/src/lib/renderComplete.ts`). A new route-level Suspense fallback must spread them too, or a slow chunk ships the spinner as the page's static HTML.
- **Admin pages** (`client/src/pages/admin/*.tsx`): Use **`React.lazy()`** in `App.tsx`. Must use `export default` (not named exports).
- **Admin-only npm packages** (`@headlessui/react`, `@heroicons/react`): Automatically code-split via lazy loading.
- **Error boundary:** `ChunkErrorBoundary` (inside the `LazyPage` wrapper, around the admin, and around the API reference on `/developers`) catches what a lazy page throws. With a `fallback` prop (a widget inside a page, such as the API reference) it renders that inline instead, leaving the page's own h1 and content in place. Without one it takes over the screen and tells two cases apart by the error. A chunk that failed to download (the browsers' "dynamically imported module" and "module script" errors, Vite's "Unable to preload CSS", webpack-style chunk errors) shows "Failed to load page" with a note that a newer version may have been deployed, and a reload button. Any other error is a crash in the page's code and shows "Something went wrong", "Reload the page to try again, or go to the homepage.", a reload button and a plain `<a href="/">` link, never the error text. Both have one h1.
- **Preloading:** `LoginPage` calls `preloadAdminChunks()` on mount.
- **Heavy widgets inside a public page** get their own `React.lazy()` chunk inside the page, with a skeleton fallback. The prerenderer snapshots once no route fallback is showing (checked from 100ms after start, at most 5s; `signalRenderComplete` in `lib/renderComplete.ts`). It does not wait for the page's own data or nested Suspense, and a page chunk that bundles a multi-MB library delays every snapshot or, past 5s, is captured as a spinner. Mount the lazy widget only after the page's first commit (a `useEffect`-set flag, plain skeleton until then): if it suspends in the page's first render, React throttles revealing the nested fallback and the snapshot still shows the route spinner. Wrap it in a `ChunkErrorBoundary` with an inline `fallback`. Example: `DevelopersPage` lazy-loads `components/developers/ApiReference.tsx` (Scalar); if that chunk fails, the reference's spot says so (`role="alert"`) with a reload button and a link to the raw OpenAPI spec (`OPENAPI_SPEC_URL` in `lib/api.ts`), and the rest of the page stays.

## Route Error Page

Whatever a route throws, during render or loading, that no `ChunkErrorBoundary` catches first (those wrap every lazy page and the admin, so this means the homepage, the public layout's header and footer, and the not-found page) lands on the root route's `errorElement`, `RouteErrorPage` (`client/src/pages/RouteErrorPage.tsx`), instead of React Router's default "Unexpected Application Error" screen. Its rules:

- **Standalone**: logo, one h1 "Something went wrong", one sentence, a "Reload page" button and a "Go to the homepage" link. No site header or footer, since the layout may be what failed. The link is a plain `<a href="/">`, a full page load that also drops whatever in-memory state failed.
- **No error text** is ever shown to readers; the title is "Something Went Wrong" and the page is `noindex`.
- **Focus** moves to the h1 (`tabIndex={-1}`) when it appears, so a screen reader announces it.
- **Logging**: `main.tsx` passes `logRouteError` to `RouterProvider` as `onError`, which logs each route error once with `console.error` and its route pattern (`Route error on /stories/:slug:`), replacing React Router's own console line. No error leaves the browser.

## Load failures

A public page whose data does not load tells "not there" apart from "not reachable right now". `loadStateOf(query)` (`client/src/lib/loadState.ts`) sorts the page's query into four states, and the page renders one view for each:

| State | When | The page shows |
|---|---|---|
| `loading` | the first answer is on its way | its skeleton |
| `ready` | the data is there (kept when a later refetch fails) | the content; a list's empty state ("No stories published yet...") only here, when the API answered with none |
| `not-found` | the API answered 404 (`isNotFound()` in `lib/api.ts`), or a query disabled for want of its slug | the page's own not-found view ("Story Not Found"), unchanged |
| `failed` | anything else: a dropped connection, a busy server, a 5xx, an answer that is not JSON, the browser offline | `LoadFailure` (`client/src/components/LoadFailure.tsx`) |

- **`LoadFailure`**: a heading naming what did not load ("This story couldn't load", "The stories couldn't load"), the line "The connection may have dropped, or the site is busy right now. Please try again." (or a page's own `hint`: `/search` answered 429 by the search rate limit says "Too many searches from this network right now. Please try again in a few minutes.", kept while "Try again" runs) and a "Try again" button that refetches the query in place, without a page reload. An h1 where the failure is the whole page, an h2 for one part of a page that keeps its own h1 (an issue page's story list, the issues list, search results, saved stories), an h3 for a list under its section's own h2 (the newsletter's past issues, the podcast's episodes). Page-level failures keep the not-found view's way back ("← Back to home", "← All issues").
- **Announced, focus untouched**: heading and line sit in a `role="alert"`, so screen readers read them when they appear; focus stays where it was. While a retry runs the state stays `failed` and the button reads "Trying again..." (TanStack Query reports a retry of a query without data as loading, or fills it with another page's placeholder data, and either would take the focused button away). Each failed attempt inserts a new alert (keyed by the query's `errorUpdatedAt`), so a failed retry is announced again, with focus still on the button. After a retry that succeeds, the content replaces the message and focus is not moved.
- **Prerender rule**: in the prerenderer (`isPrerendering()`, `lib/renderComplete.ts`) `loadStateOf` returns only `ready` or `loading`. The build's API may be missing or answer anything, so a prerendered page (`/`, `/issues` and the issue pages, `/search`, `/saved`, `/newsletter`, `/podcast`) never bakes "not found" or "couldn't load" into its static HTML; it bakes its skeleton. `dist/index.html` is also the shell every story page is served in (`.context/seo.md`, "Story link previews"). `isPrerendering()` is only `navigator.webdriver`, true in any automated browser, so the pages that are never prerendered (story, newsletter issue and transcript pages) call `loadStateOf(query, false)`: a 404 there shows the not-found view, with its `noindex` where the page has one, in every browser.
- **In use on**: `/` (`HomePage`), `/stories/:slug`, `/issues/:slug` (the issue, and its story list under the issue's heading: a skeleton while the first page loads, the current page kept on screen while another page or mood loads, `useIssueStories`), `/newsletter/:slug`, `/podcast/:id/transcript`, `/issues` (the list of issues), `/search` (the results), `/saved` (the saved stories), `/newsletter` (the past issues) and `/podcast` (the episodes). A list that has no not-found view of its own (the home page's stories and the lists above) shows `LoadFailure` for a 404 too. On `/saved` each story is its own request: a story that is gone (404) drops out of the list, as before, and the list fails only when none of the stories loaded and one failed for another reason. That query never retries on its own (`retry: false`): one attempt asks for every saved story against the public API's per-IP limit, so only "Try again" asks again. A failure there carries no `noindex`: it is transient, unlike a not-found page.

## Accessibility (WCAG 2.2 AA)

See `.context/accessibility.md` for full WCAG patterns, ARIA, and testing checklist.

**Common requirements:**

- **Links/buttons**: `focus-visible:ring-2 focus-visible:ring-brand-500`
- **Link color**: Use `text-brand-700` (not brand-600) for AA contrast
- **Images**: Always include `alt` text (use `alt=""` for decorative)
- **Forms**: Every input needs a `<label>` with matching `htmlFor`/`id`
- **Touch targets**: Minimum 24x24px

## Spelling & Language

All hardcoded static text (UI labels, headings, descriptions, error messages, tooltips, meta tags) must use **American English** spelling. Examples: "analyzed" (not "analysed"), "color" (not "colour"), "organize" (not "organise"). Proper nouns that use British spelling (e.g. organization names like "Centre for...") are exempt.

Use em dashes sparingly in user-facing copy. One per paragraph at most. Overuse is a tell for AI-generated text. Prefer commas, periods, or rewriting the sentence instead.

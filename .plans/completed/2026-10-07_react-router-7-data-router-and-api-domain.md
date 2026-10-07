---
plan-id: react-router-7-data-router-and-api-domain
title: Upgrade to react-router 7 with the data router so browser Back is guarded, and point code-side references at api.actuallyrelevant.news
status: implemented
created: 2026-10-07
author: claude-code (AI)
repo: OdinMB/actually-relevant
themes: []
decisions:
  - ref: .context/decisions/0018-react-router-7-data-router.md
  - ref: .context/decisions/0019-api-host-api-actuallyrelevant-news.md
type: feature
complexity: complex
---

# React Router 7 data router (guarded Back) and the API custom domain

Both decisions above were made by the owner, Odin Mühlenbein, in session on 2026-10-07 ("Option 2 for routing"; the Render custom domain set up and verified). The agent made the implementation choices under Approach.

## Problem

(A) The admin's unsaved-changes guard (podcast Stories and Script tabs) holds tab switches, in-app link clicks and tab close, but not the browser's Back button: the app uses `BrowserRouter`, where `useBlocker` is unavailable. react-router-dom 6 also carries Dependabot alerts 128/129, dismissed only because no navigation target is user-controlled today (LoginPage's return path from `location.state` comes close). (B) The API now answers at `https://api.actuallyrelevant.news`, but `server/env.example`, the OpenAPI fallback server URL and the docs still name the `onrender.com` host or say the domain does not resolve.

## Approach

**A. Router.** Upgrade `react-router-dom` to the latest 7.x (caret range plus lockfile, as every other dependency; confirm the installed version is at or above the patched version both Dependabot alerts name, `gh api repos/OdinMB/actually-relevant/dependabot/alerts/128` and `/129`, read-only). Keep importing from `react-router-dom` (a supported re-export in v7), so ~60 files stay untouched; moving imports to `react-router` is v8 work.

- `App.tsx` stops exporting an `App` component and exports `appRoutes: RouteObject[]`, built with `createRoutesFromElements` from the **same JSX route tree** under one pathless root route whose element renders `<DefaultSeo />` and `<Outlet />`. Every path, layout, `LazyPage`/`ChunkErrorBoundary`/`Suspense` wrapper, the admin nesting and the `*` catch-all stay as they are; `preloadAdminChunks` stays exported (LoginPage imports it). No route `loader`s or route-level `lazy`: with neither, the router initialises synchronously, so the first render, and therefore prerendering (`render-complete` 100 ms after `render`), behaves as today.
- `main.tsx` creates the router (`createBrowserRouter(appRoutes)`) and renders `HelmetProvider > QueryClientProvider > AuthProvider > RouterProvider`. `AuthProvider` uses no router hook, so it can sit outside the router. Creating the router in `main.tsx` rather than at `App.tsx`'s module scope keeps `App.tsx` free of side effects, so tests can build `createMemoryRouter(appRoutes)` and `RequireSession.test`'s `vi.mock('../../App')` keeps working. The v6 `future` flags go (they are v7's defaults).
- Alternatives considered: keeping `BrowserRouter` and blocking Back by hand with `popstate` (fragile, owner rejected it as option 1); rewriting the tree as plain route objects (bigger diff, no gain over `createRoutesFromElements`); route-level `lazy` instead of `React.lazy` (changes the chunk/prerender timing that works today; out of scope).

**Guard.** `useUnsavedChangesGuard` keeps its interface (`guard`, `asking`, `confirm`, `cancel`) and its `beforeunload` handler, and replaces the capture-phase document click listener with `useBlocker`:

- The blocker holds a navigation when `dirty` and the next **pathname** differs from the current one. That covers `Link`/`NavLink` clicks, `navigate()` calls and browser Back/Forward with one mechanism. Same-path search changes pass: they are the page's own URL state (the podcast tab is written with `replace: true`, and a starting run resets it), and user tab switches already go through `guard()`. Holding them too would make a confirmed tab switch ask twice.
- A navigation whose `state` carries the hook's exported marker `LEAVE_UNSAVED` (`{ leaveUnsaved: true }`) passes. `PodcastActionBar`'s post-delete `navigate('/admin/podcasts')` uses it: deleting the episode already discards its edits, and without the marker the blocker would ask "Discard changes?" after the episode is gone.
- One dialog for every path: `asking` is true while either a guarded action is pending or the blocker is `blocked`; `confirm` calls `blocker.proceed()` or runs the action, and `cancel` calls `blocker.reset()` or clears it. Leaving the app altogether (reload, close, a plain full-page link) still gets the browser's own `beforeunload` prompt, which no page can replace.
- `internalLinkTarget` loses its only caller and is deleted (no tests reference it).
- The click listener goes rather than staying beside the blocker because both would fire on a `Link` click: the listener's `navigate(to)` on confirm would be blocked again, asking twice.

**B. API domain.** Code-side references move to `https://api.actuallyrelevant.news`; nothing in Render changes. `API_URL` feeds only the OpenAPI spec's `servers` entry (its `env.example` comment about confirmation links is stale and is corrected). The client has no hard-coded API host: `api.ts`, `admin-api.ts`, `session.ts`, the preconnect/dns-prefetch hint and the homepage preload all derive from `VITE_API_URL`, so they follow when the owner switches it; `widget.js` already names the new host, so widget embedders, broken while the domain did not resolve, load stories again. CORS needs no change: restricted CORS checks the *caller's* origin (`FRONTEND_URL`, `https://actuallyrelevant.news`, plus dev ports), not the API host; public read paths stay open to all origins. The refresh cookie sets no `domain`, so it is host-only on whichever API host issued it; the default SameSite stays as is. Existing consumers of `actually-relevant-api.onrender.com` keep working: Render keeps the service's `onrender.com` host alongside a custom domain.

## Changes

| File | Change |
|------|--------|
| `client/package.json`, `client/package-lock.json` | `react-router-dom` to latest `^7.x` via `npm install react-router-dom@^7 --prefix client` |
| `client/src/App.tsx` | Replace the `App` component with exported `appRoutes` (`createRoutesFromElements`, same tree) under a private `RootLayout` route element (`<DefaultSeo />` + `<Outlet />`); keep `preloadAdminChunks`, `LazyPage`, fallbacks |
| `client/src/main.tsx` | `createBrowserRouter(appRoutes)` + `RouterProvider` inside `AuthProvider`; drop `BrowserRouter` and its `future` prop |
| `client/src/hooks/useUnsavedChangesGuard.ts` | Swap the click listener for `useBlocker` (pathname rule, `LEAVE_UNSAVED` marker); merge blocker state into `asking`/`confirm`/`cancel`; delete `internalLinkTarget`; rewrite the doc comment |
| `client/src/components/admin/PodcastActionBar.tsx` | Post-delete `navigate('/admin/podcasts', { state: LEAVE_UNSAVED })` |
| `client/src/test/podcasts.tsx` | `renderInAdmin` builds `createMemoryRouter([{ path: '*', element: … }], { initialEntries, initialIndex })` + `RouterProvider` (useBlocker throws outside a data router) and returns the router with the render result; accepts an optional entry list for history tests |
| `server/env.example` | `API_URL="https://api.actuallyrelevant.news"`; comment: "Public API base URL, shown as the server in the OpenAPI spec" |
| `server/src/lib/openapi.ts` | Fallback server URL → `https://api.actuallyrelevant.news` |
| `README.md` | Health-check example uses `https://api.actuallyrelevant.news/health`; the cookie note says the domain is live and what remains. Render rewrite destinations stay `<backend-service>.onrender.com` placeholders (both hosts work; the owner's dashboard holds the real ones) |
| `.context/authentication.md` | "Cross-site cookie in production": step 1 done 2026-10-07 (domain verified, certificate issued); steps 2–3 remain; drop "did not resolve" |
| `.context/admin-dashboard.md` (line 46), `.context/podcast.md` (line 203) | Guard now holds browser Back and `navigate()` too, via `useBlocker`; same-path search changes pass; `LEAVE_UNSAVED` for a navigation that already discards the edits |
| `.context/public-website.md` | Routes are registered in `App.tsx`'s `appRoutes` (data router) and `routes.ts`; grep `.context/` (`seo.md`, `ui-conventions.md`) for other "App.tsx"/`BrowserRouter` wording that turns untrue |
| `.context/ai-transparency.md` | Remove the open-items row (line 145) about `widget.js`'s host not resolving: it resolves since 2026-10-07; check line 56 still holds. ADR-0010's "did not resolve" stays (the log is history) |
| `BACKLOG.md` | Delete the react-router item. Rewrite the API-domain item to what remains: owner sets `VITE_API_URL=https://api.actuallyrelevant.news` on the static site and redeploys (everyone logs in once more), checks `API_URL` on the API service (set it to the new host or unset it, so the OpenAPI docs name it), then sets `AUTH_COOKIE_SAMESITE=strict` |

## Tests

Following the existing `PodcastDetail.test.tsx` "unsaved changes" block (renderInAdmin, `Where` probe, `ConfirmDialog` by role):

- **Browser Back while dirty**: history `['/admin/podcasts', '/admin/podcasts/pod-1']` at index 1, make an edit, `router.navigate(-1)` → dialog shows and location stays; Cancel keeps the page and the edit; Back again + "Discard changes" lands on `/admin/podcasts`.
- **In-app link** (existing test, now through the blocker): still held, still follows on confirm.
- **Tab switch confirm asks once**: extend "switches once the discard is confirmed" to assert the dialog is gone and the tab changed after one confirm (guards against the search-change double prompt).
- **No edits, no prompt**: Back with nothing unsaved navigates at once.
- **Marker passes**: a dirty page and a `navigate(path, { state: LEAVE_UNSAVED })` navigates without a dialog (in `PodcastActionBar.test.tsx` through delete, or a small hook-level test).
- **Route tree**: `createMemoryRouter(appRoutes, { initialEntries: ['/no-such-page'] })` renders the 404 page inside the public layout (catch-all still last and still matched).
- Existing suites using `MemoryRouter` + `Routes` (RequireSession return path, SearchPage URL state, a11y) must pass unchanged.

**Build checks (manual, not unit):** `npm run typecheck` and `npm run test -- --run` (client), `npm run build --prefix server`; then `npm run build --prefix client` and confirm in `dist/` that prerendered `index.html`, `about/`, `methodology/`, `issues/planet-climate/`, `developers/` and `podcast/` each hold their real `<h1>` (not the spinner) and their Helmet title, and that admin chunks are still separate files. In the running dev app (:5173), check an admin podcast edit: Back asks, sidebar link asks, reload gets the browser prompt; and that `/admin/...` signed out still returns to the deep URL after login.

## Out of Scope

- Changing `VITE_API_URL`, `API_URL` or `AUTH_COOKIE_SAMESITE` in Render, or the default SameSite (owner, later).
- Pointing the Render `/sitemap.xml` and `/podcast.xml` rewrites at the new host (dashboard; both hosts work).
- Moving imports from `react-router-dom` to `react-router`; route `loader`s, route-level `lazy`, `ScrollRestoration`, a root `errorElement`.
- Unsaved-changes guards on other admin edit pages (IssueEditPage, StoryEditForm).
- The post-build prerender content check in BACKLOG (stays a backlog item; this plan checks by hand).

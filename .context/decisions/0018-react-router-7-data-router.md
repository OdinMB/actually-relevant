---
id: ADR-0018
title: Route the client through react-router 7's data router, built from a route tree App.tsx exports
status: accepted
date: 2026-10-07
deciders: ["Odin Mühlenbein", "claude-code (AI)"]
context-repo: OdinMB/actually-relevant
themes: [handover]
tags: ["client", "routing"]
---

# ADR-0018 · Route the client through react-router 7's data router, built from a route tree App.tsx exports

## Context

The admin's podcast editor held unsaved edits against tab switches, in-app link clicks (through a
capture-phase document click listener) and tab close, but not against the browser's Back button.
The client rendered its routes inside `BrowserRouter` (react-router-dom 6), and react-router's
`useBlocker`, the hook that holds a navigation of any kind, works only under a data router
(`createBrowserRouter` + `RouterProvider`). react-router 6 also carried Dependabot alerts 128 and
129, fixed in react-router 7.18.0; they had been dismissed only because no navigation target was
user-controlled.

The route tree lived as JSX inside an `App` component (lazy pages wrapped in `Suspense` and
`ChunkErrorBoundary`, a public and an admin layout, a `*` catch-all). Public pages are prerendered
with Puppeteer, which snapshots each page 100 ms after `main.tsx` dispatches `render-complete`, so
anything that delays the first render changes what crawlers see. Over 60 files import from
`react-router-dom`.

The owner chose the data router ("option 2") over blocking Back by hand on 2026-10-07; the agent
chose how to build it.

## Decision

We use react-router 7 (`react-router-dom` ^7, still imported from `react-router-dom`, which v7
re-exports) with its data router. `App.tsx` exports `appRoutes: RouteObject[]`, built with
`createRoutesFromElements` from the same JSX route tree under one pathless root route that renders
`DefaultSeo` and an `Outlet`; `main.tsx` creates `createBrowserRouter(appRoutes)` and renders it
through `RouterProvider` inside `AuthProvider`. Routes have no `loader`s and no route-level `lazy`,
so the router is ready synchronously and the first render happens as before. Unsaved-changes
guards use `useBlocker` (`useUnsavedChangesGuard`), which holds link clicks, `navigate()` calls and
browser Back/Forward alike.

## Consequences

- Browser Back is held on pages with unsaved edits; the hand-written click listener is gone.
- Tests of a component that uses `useBlocker` must render it under a data router
  (`createMemoryRouter` + `RouterProvider`), not `MemoryRouter`; `renderInAdmin` does this for the
  podcast admin. Tests can build a memory router from `appRoutes`, since `App.tsx` has no side
  effects.
- A router allows one active blocker at a time, so two guarded components on one page would
  conflict.
- The data router catches a render error in a route with its own default error screen, where
  before an uncaught error unmounted the whole app; no route sets an `errorElement` yet.
- Imports still go through `react-router-dom`, which v8 is expected to drop: revisit when
  upgrading to react-router 8, or if route `loader`s or route-level `lazy` are wanted (both change
  the first-render and prerender timing and need the prerender checked).

## Alternatives considered

- **Keep `BrowserRouter` and block Back by hand with `popstate`** — fragile against the router's own
  history handling; the owner rejected it (option 1).
- **Rewrite the routes as plain route objects** — a larger diff with no gain over
  `createRoutesFromElements`, which keeps the tree readable as JSX.
- **Create the router at `App.tsx`'s module scope** — would make importing `App.tsx` (as LoginPage
  does for `preloadAdminChunks`, and tests do) create a browser router as a side effect.
- **Move all imports to `react-router` now** — touches 60 files for no behaviour change; left for
  the v8 upgrade.

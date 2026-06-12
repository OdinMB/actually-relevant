# Admin "Subscribers" Page (DB vs Plunk, read-only)

- **Date**: 2026-06-12
- **Status**: completed
- **Type**: feature

## Problem
Admins have no way to see the newsletter subscriber list or how it lines up with Plunk. We learned this week that signups create unsubscribed Plunk contacts and that confirmed subscribers live authoritatively in our own Postgres — but there's no UI to inspect either side or spot drift (e.g. confirmed-locally-but-not-subscribed-in-Plunk, or Plunk contacts with no local row). Add a read-only "Subscribers" admin page that lists what's in our DB alongside what Plunk reports.

## Approach
Add one read-only admin endpoint `GET /api/admin/subscribers` backed by a new `subscribers` service that (1) reads all `PendingSubscription` rows from Postgres, (2) reads all Plunk contacts via the existing `plunk.listContacts` pagination loop, and (3) reconciles them by lowercased email into a summary + per-email rows. A new `/admin/subscribers` page (mirroring `NewslettersPage`) renders summary cards and a single reconciled table keyed by email (Email · DB status · Plunk status · dates). Plunk is treated as best-effort: if it's unavailable (e.g. `403 PROJECT_DISABLED`), the page still renders DB data with a "Plunk unavailable" notice.

**Rows shown vs. collapsed (per user decision):** the returned `rows` include only the *meaningful* set — an email that is **in our DB (any status) OR subscribed in Plunk**. Plunk contacts that are **unsubscribed AND have no local row** (the never-confirmed bot entries) are *not* sent as rows; they're aggregated into a single summary number (`plunk.unsubscribedNotInDb`) shown as e.g. "1,240 never-confirmed Plunk contacts (purged by the cleanup job)". This keeps the payload and table small and readable while still surfacing the drift as a count.

**Why reconcile by email rather than two separate lists:** the user asked for "DB vs Plunk." A single table keyed by email with DB-status and Plunk-status columns *is* the comparison, and is less code than two independent tables while being far more useful (it surfaces the exact drift we discussed). Alternative considered — two plain side-by-side lists — is more literal but makes mismatches invisible and isn't simpler. Final presentation is confirmed with the user before implementation (see Open Questions).

**Why a new service file** (`services/subscribers.ts`) rather than extending `services/subscribe.ts`: `subscribe.ts` owns the signup/confirm *mutation* flow (a distinct reason to change). Admin read + reconciliation is a separate responsibility; giving it its own deep module keeps `subscribe.ts` focused. The route file stays thin and delegates to the service, per the existing admin-route convention (`routes/admin/feeds.ts`).

**Plunk fetch (bounded + resilient):** the reconciliation needs all Plunk contacts, fetched via the cleanup script's `listContacts` loop, but the loop is bounded on three axes so a bot-bloated or degraded Plunk can't hang the admin request:
- *Page-shape normalization (critical):* `listContacts` is **declared** to return `{ items, … }` but its runtime shape is unverified (it may return `{ contacts: [] }`). The service normalizes each page **before** iterating — `const items = Array.isArray(page?.items) ? page.items : (Array.isArray(page?.contacts) ? page.contacts : [])` — and stops when a page yields no items / no `nextCursor`. This avoids the `for…of undefined` throw the cleanup script is currently exposed to.
- *Safety cap:* max pages/contacts; hitting it sets `truncated: true`.
- *Overall timeout:* the whole loop runs under one budget (`Promise.race` ~10s). On timeout, or on a page that throws **after** ≥1 page succeeded, return what was collected with `partial: true` (still `available: true`) rather than discarding everything. Only a failure on the **first** call yields `available: false, error` (e.g. `PROJECT_DISABLED`). `total` comes free on the first page.

**DB dedup (correctness):** `PendingSubscription.email` is **not** unique (only `token` is) — a confirmed row plus a leftover pending row can coexist for one email. The reconcile core dedupes DB rows by lowercased email, **preferring the confirmed row** (else the most recent), and all `db.*` summary counts are over **distinct emails**, not raw rows.

## Changes

### Backend

| File | Change |
|------|--------|
| `server/src/services/subscribers.ts` | **NEW.** *Responsibility:* read DB subscribers + Plunk contacts and reconcile them into a summary + per-email rows, degrading gracefully when Plunk is unavailable/slow. *Exports:* `getSubscriberReconciliation()` plus the `SubscriberReconciliation` / row types and a **pure, exported `reconcile(dbRows, plunkContacts)`** core (so the union/dedup/count logic is unit-testable with plain inputs, no mocks). `getSubscriberReconciliation` does the Prisma read + the bounded/normalized/timeout-guarded `listContacts` loop (see Approach), dedupes DB rows by email, then calls `reconcile`. Plunk failures map to `plunk.available:false` (first-call failure) or `plunk.partial:true` (mid-loop), never a throw. |
| `server/src/routes/admin/subscribers.ts` | **NEW.** *Responsibility:* `GET /` admin route that calls `getSubscriberReconciliation()` and returns it as JSON. Mirrors `routes/admin/feeds.ts` (Router + logger + try/catch → 500). Auth is inherited from `routes/admin/index.ts` (`requireAuth` + `requireRole('admin','editor')`) — no per-route guard. *Exports:* default router. |
| `server/src/routes/admin/index.ts` | Register `router.use('/subscribers', subscribersRouter)` next to the existing admin sub-routers. |

### Frontend

| File | Change |
|------|--------|
| `client/src/lib/admin-api.ts` | Add a `SubscriberReconciliation` (+ row) type near the other `*Item` interfaces, and a read-only `subscribers: { list: () => request<SubscriberReconciliation>('/subscribers') }` block in `adminApi` after the `users` block. |
| `client/src/pages/admin/SubscribersPage.tsx` | **NEW.** *Responsibility:* render the Subscribers page — Helmet title, `PageHeader title="Subscribers"`, an **inline** `useQuery({ queryKey: ['subscribers'], queryFn: () => adminApi.subscribers.list() })` (no dedicated hook file — read-only, single query, matching how `DashboardPage`/`FeedbackPage` inline their queries), the four-state render (loading spinner / `ErrorState` / `EmptyState` / content), a "Plunk unavailable/partial" notice when applicable, summary cards, and the table. *Exports:* default `SubscribersPage`. |
| `client/src/components/admin/SubscribersTable.tsx` | **NEW.** *Responsibility:* render reconciled rows (email + DB status badge + Plunk status badge + relevant dates). *Exports:* default `SubscribersTable`. Mirrors the existing admin table components' markup/`Badge` usage. |
| `client/src/layouts/AdminLayout.tsx` | Insert `{ name: 'Subscribers', href: '/admin/subscribers', icon: UserGroupIcon }` into the `navigation` array directly below the `Newsletters` entry. `icon` is a **component reference** (not JSX) — `NavItems` renders `<item.icon … />`. Add `UserGroupIcon` to the `@heroicons/react/24/outline` import block (confirm it isn't already imported; it's distinct from the `UsersIcon` used by the Users nav item). |
| `client/src/App.tsx` | Add `const SubscribersPage = lazy(() => import('./pages/admin/SubscribersPage'))` and a `<Route path="subscribers" element={<SubscribersPage />} />` directly below the newsletters route. |

### Tests

| File | Change |
|------|--------|
| `server/src/services/subscribers.test.ts` | **NEW.** Unit-test the reconcile core (below). |
| `server/src/routes/admin/subscribers.test.ts` | **NEW.** Route test mirroring `routes/admin/users.test.ts` (vi.hoisted prisma mock, mocked `services/subscribers.js` or `services/plunk.js`, `crawler` mock, `authHeader()`). |
| `client/src/pages/admin/SubscribersPage.test.tsx` | **NEW.** Page test mirroring `DashboardPage.test.tsx` (Helmet/MemoryRouter/QueryClient wrapper, `vi.mock('../../lib/admin-api')`). |

## Tests
Logic-bearing tests to write:

- **Reconcile core** (`reconcile(dbRows, plunkContacts)`, pure — no mocks):
  - Email present in both DB (confirmed) and Plunk (subscribed) → row marked in-DB-confirmed + in-Plunk-subscribed; counted once.
  - Email confirmed in DB but absent/unsubscribed in Plunk → flagged as a mismatch ("confirmed locally, not subscribed in Plunk").
  - Email subscribed in Plunk but no DB row → included as a row, flagged as a mismatch ("in Plunk, no local row").
  - Email unsubscribed in Plunk and no DB row (never-confirmed bot) → **excluded from `rows`** but counted in `plunk.unsubscribedNotInDb`.
  - **Duplicate DB rows for one email** (a confirmed row + a leftover pending row) → collapses to a single row that reflects the *confirmed* status; `db.total`/`db.confirmed` count it once.
  - Case-insensitive matching (`REAL@x` in DB matches `real@x` in Plunk) — same convention as the cleanup script.
  - Summary counts: db total/confirmed/pending (distinct emails), plunk total/subscribed/unsubscribed, mismatch counts.
- **`getSubscriberReconciliation` Plunk handling** (`subscribers.test.ts`, mock `plunk.listContacts`):
  - First `listContacts` call throws (e.g. `PROJECT_DISABLED`) → `plunk.available === false`, full DB side still returned.
  - A page returns a non-array `items` (defensive shape) → treated as empty, loop stops, no throw.
  - A later page throws after an earlier page succeeded → `plunk.partial === true`, `available === true`, reconciliation uses the contacts collected so far.
- **Route** (`subscribers.test.ts`): `GET /api/admin/subscribers` returns 200 with the reconciliation shape when the service resolves; returns 500 on service error. (Auth is exercised by the shared admin-router pattern; one unauthenticated 401 case for parity with siblings.)
- **Page** (`SubscribersPage.test.tsx`): renders summary + rows from mocked `adminApi.subscribers.list`; shows the "Plunk unavailable" notice when `plunk.available === false`; shows `EmptyState` when there are no rows.

No tests for: nav/route wiring, Helmet copy, badge labels, or other static content.

## Out of Scope
- **Any write to Plunk or the DB** — strictly read-only. No edit/delete/resubscribe actions, no triggering the cleanup or a backup from this page.
- **Scheduling** the cleanup or building the `backup-subscribers.ts` script (separate, already-discussed items).
- **Fixing `plunk.listContacts` if its live response shape differs** from the declared `{ items, nextCursor, hasMore, total }` (the pagination-shape uncertainty flagged earlier). The service normalizes page shape defensively so a wrong shape degrades to "Plunk empty/unavailable" rather than crashing — but it won't *repair* a broken wrapper. **Prerequisite for the Plunk side to show real data:** during implementation, make one live `listContacts` call with the real secret key and confirm the actual response shape; if it differs, fixing the wrapper is a separate pre-existing bug (out of scope here, but blocks the Plunk column being meaningful).
- **`firstName`** — not persisted anywhere, so it can't be shown.
- **Server-side pagination / search** of the table — render the (capped) reconciled set; revisit only if the list is large in practice.

## Resolved Decisions
1. **Table content** — reconciled union table keyed by email (Email · DB status · Plunk status · dates) with summary cards. *(user-approved)*
2. **Bot noise** — collapse Plunk's unsubscribed-and-not-in-DB contacts into a single summary count; keep table rows to the meaningful set (in DB OR subscribed in Plunk). *(user-approved)*

# Admin Dashboard

The admin dashboard is a React SPA at `/admin/*` with 10 pages, JWT-based auth with httpOnly refresh cookies, and TanStack Query for data fetching.

## Architecture

- **Auth**: `AuthProvider` wraps the app; stores JWT access token in memory (not localStorage), uses httpOnly cookie for session refresh, redirects to `/admin/login` on auth failure. See `.context/authentication.md` for details.
- **API Client**: `admin-api.ts` provides typed `adminApi.*` methods organized by resource with Bearer auth headers. Auto-refreshes expired tokens via `/api/auth/refresh`.
- **Data Fetching**: TanStack Query with 30s stale time, hooks in `hooks/use*.ts` per resource
- **UI Components**: Headless UI + Tailwind in `components/ui/` (Button, Badge, Card, Pagination, etc.)
- **Admin Components**: Resource-specific in `components/admin/` (tables, forms, detail views)
- **Toast Notifications**: `ToastProvider` in AdminLayout, `useToast()` hook for success/error/progress messages. A progress toast never fades; `addProgressToast(id, message, { href })` and `updateToast(id, { href, sticky })` make a toast a router link to the page it is about (keyboard-reachable) and keep an outcome, typically an error, until it is dismissed. Existing callers pass neither. The toast list is a polite live region, so every text change in it is announced: for a progress count that changes often, pass it as `addProgressToast(id, message, { detail })`, which is shown after the message but `aria-hidden` (a link toast's name still includes it), so only a change of `message` is announced; an outcome drops the detail. The podcast run toast does this for its chunk count.
- **Jobs page errors**: the enable toggle and the Run button (on the Jobs page and the Dashboard) show the server's error text in the error toast (`ApiError.message`): a 422 naming the missing settings when a job's enable check refuses, a 409 when the job is already running (`.context/scheduler.md`).
- **Background Tasks**: `BackgroundTaskProvider` in AdminLayout, `useBackgroundTasks()` hook for fire-and-forget async operations with progress tracking via persistent toasts
- **New version notice**: each client build compiles in an id (`__BUILD_ID__`, `vite.config.ts`) and writes it to `dist/version.json`. `NewVersionBanner` in AdminLayout compares the two on window focus and every 5 minutes and offers a reload when they differ, so an admin tab left open across a deploy does not keep showing old screens (missing buttons, raw job ids). On the dev server there is no `version.json` and the banner stays hidden. Job names go through `jobDisplayName()`, which title-cases a job id the running build has no label for.
- **Long server-side runs** (the pattern for work that outlives the request and the page): the route claims the work before it answers 202, the server lists what is running (`GET /api/admin/podcasts/active`), and an app-level provider in AdminLayout (`PodcastProgressProvider`) asks it on mount and on window focus, polls while it follows anything, and keeps one clickable toast per run until its outcome. The client never guesses when a run starts or ends, so the toast survives navigation and reattaches after a reload. See `.context/podcast.md`, "Progress".

## Route Structure

```
/admin/login          → LoginPage (no auth)
/admin                → AdminLayout (auth required)
  /admin              → DashboardPage (stats + jobs health)
  /admin/stories      → StoriesPage (filters, table, bulk actions)
  /admin/stories/:id  → StoryDetailPage
  /admin/feeds        → FeedsPage
  /admin/issues       → IssuesPage
  /admin/issues/new   → IssueEditPage
  /admin/issues/:id/edit → IssueEditPage
  /admin/newsletters  → NewslettersPage
  /admin/newsletters/:id → NewsletterDetailPage
  /admin/subscribers  → SubscribersPage (read-only: local DB vs Plunk reconciliation)
  /admin/podcasts     → PodcastsPage
  /admin/podcasts/:id → PodcastDetailPage
  /admin/jobs         → JobsPage (auto-refreshes every 10s)
  /admin/users        → UsersPage (admin-only user management)
```

## Key Patterns

- **Story filters** persist in URL search params via `useSearchParams()`
- **Bulk actions** use selection state (resets on filter/page change) with confirmation dialogs
- **Bulk LLM operations** (preassess, assess, select) run as background tasks via `useBackgroundTasks()` — dialog closes immediately, progress toasts persist across navigation, query invalidation fires on completion
- **LLM operations** (newsletter generation) show persistent loading state with "may take a minute" message
- **Podcast episodes** run server-side in the background: Resume and a rewind that continues answer 202 once they hold the episode's lease, `usePodcastProgress().track(id)` follows the run, and the detail page polls every 5 s only while the lease is live (`inProgress`). The detail page is tabbed by stage (`?tab=`) with a sticky action bar at the bottom; a component that holds unsaved edits (story picker, script editor) reports it to the page, which keeps approval disabled and guards tab switches and in-app links until they are saved or discarded; see `.context/podcast.md`, "Admin". **New podcast** on the list creates a standalone episode whose stories a person picks in `PodcastStoryFinder` (filters, paginated published stories, AI "Suggest stories"), sharing the draft hook `usePodcastStoryDraft` with the weekly picker; see `.context/podcast.md`, "Standalone episodes"
- **Unsaved-changes guard**: `useUnsavedChangesGuard(dirty)` returns `guard(action)` plus the state for a `ConfirmDialog`; while dirty it also holds every in-app navigation to another path through react-router's `useBlocker` (a `Link`, a `navigate()` call, browser Back/Forward) in the same dialog, and asks on reload or close (`beforeunload`). A change of the search alone on the same path passes (it is the page's own URL state, such as `?tab=`; tab switches go through `guard`). A navigation that itself discards the edits passes `state: LEAVE_UNSAVED` (e.g. after deleting the episode). `useBlocker` needs the data router (`createBrowserRouter` in `main.tsx`), so a component test of a guarded page renders in a `createMemoryRouter`, as `renderInAdmin` in `client/src/test/podcasts.tsx` does; a router allows one active blocker at a time
- **Actions that cannot run now stay visible with their reason**: `ReasonButton` (`aria-disabled`, focusable, the reason as tooltip and `aria-describedby`) rather than a hidden or plainly disabled button. `Tooltip` (`components/ui/Tooltip.tsx`) opens on hover and keyboard focus, stays while hovered, closes on Escape, and keeps its text in the DOM for the description
- **Sticky action bars** sit at the end of the page in flow (`sticky -bottom-4 lg:-bottom-6`, negative margins to the edges of `<main>`'s padding: `<main>` is the scroll container and a `bottom-0` would stick at its padding edge, leaving a strip below the bar that content scrolls through) rather than `fixed`, so they never cover content, and below the toasts (`z-10` against `z-50`)
- **Carousel ZIP download** uses `response.blob()` + `URL.createObjectURL` + auto-click download
- **Cron editing** is inline in the jobs table with save/cancel
- **Issue slug** auto-generates from name in create mode
- **Issue hierarchy** supports one level of nesting (parent/child). Issues table shows children indented under parents. Edit form has optional parent selector and static content editors (evaluation criteria, sources, make-a-difference links). Feed selector shows hierarchical issue dropdown.
- **Subscribers page** is read-only: `GET /api/admin/subscribers` (service `subscribers.ts`) reads all `PendingSubscription` rows and all Plunk contacts, dedupes the DB side by email, and reconciles by lowercased email into summary counts + a table (DB status vs Plunk status, with "drift" rows). Plunk is the authoritative list — every Plunk contact is shown, sorted subscribed-first, then unsubscribed, then rows absent from Plunk (drift first within a group). Plunk is best-effort: if it's unavailable (`PROJECT_DISABLED`) or the bounded fetch only partially completes, the page still renders the DB side with a notice. An "Export CSV" action downloads the reconciled rows client-side (`lib/subscribersCsv.ts`) for an email-address backup.

## File Locations

- API client: `client/src/lib/admin-api.ts`
- Auth: `client/src/lib/auth.tsx`
- Query config: `client/src/lib/query.ts`
- Constants/formatting: `client/src/lib/constants.ts`
- Hooks: `client/src/hooks/use*.ts`
- UI components: `client/src/components/ui/*.tsx`
- Admin components: `client/src/components/admin/*.tsx`
- Pages: `client/src/pages/admin/*.tsx`
- Layout: `client/src/layouts/AdminLayout.tsx`

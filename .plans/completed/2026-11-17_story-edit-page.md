---
status: implemented
type: feature
complexity: complex
---

# The story editor as a full page, with the way back to the list as it was

Odin asked on 17 Nov: "The story editing now covers so many elements that it might be worth pulling it out of the sidebar version and moving it into a full page view (with back to story overview with the same filter settings as before)." The plan is approved as asked; what the request left open is settled under "Approach" and listed in the implementer's report. Context: `.context/admin-dashboard.md` (unsaved-changes guard, sticky action bars, the research and context sections), `.context/ui-conventions.md` (admin pages lazy-loaded), `.context/accessibility.md` (headings, links). The handbook's `plan-decisions` skill was not loaded when this plan was written, so it has no handbook header and no decision stubs; nothing here is hard to reverse, so no ADR.

## Problem

Opening a story on the admin stories list slides in a 512px side panel (`StoryDetail`, an `EditPanel`) holding `StoryEditForm`: some fifteen fields, the source, the cluster, the social posts, Research with its run view and Context with its cards and run record. It is cramped, it has no URL of its own (it lives in local state, so a reload or a shared link loses it), and the page variant that already exists at `/admin/stories/:id` is a bare single column whose Back button forgets the list's filters, whose footer is `fixed` (against the sticky-bar convention) and which lacks the social post buttons.

## Approach

### One editor, a page

- **`/admin/stories/:id` (`StoryDetailPage`, already lazy in `App.tsx`) is the only story editor.** The panel (`StoryDetail.tsx`) and `StoryEditForm`'s `variant` go; story editing no longer uses `EditPanel`.
- **Layout.** A "Back to stories" link, the story's title as the h1, then the form: one column below `xl`, two from `xl` (1280px) up: the editable fields on the left; the source, the cluster, the social posts, Research and Context on the right, each group a white card. The right column holds what the panel held at about the panel's width, so the run views and context cards render as they did. A sticky action bar (Save, Cancel) at the end of the page in flow, as the convention says, replacing the `fixed` footer.
- **Headings.** The page has an h1, so the sections become h2 (Source, Cluster, Bluesky, Mastodon, Research, Context), and the levels inside Research's and Context's views move up one with them (no skipped level).
- **Social posts.** The page has the Bluesky and Mastodon buttons the panel had. Their panels, state and handlers move out of `StoriesPage` into `useSocialDrafts()` (`components/admin/social/useSocialDrafts.tsx`), used by the list (bulk drafts) and the page (one story's draft).
- **Save** saves and returns to where the story was opened from, as Save closed the panel. **Cancel** returns there too; both ask first while edits are unsaved.
- **Not found.** A 404 shows "Story not found" under the back link; any other failure keeps "Failed to load story" with Retry.

### The way back

- **Opening a story carries its return.** A link to a story's page carries location state `returnTo`: the path and search it was opened from, the history entry's key, and a label naming that page (`storyReturn.ts`): from the stories list "Back to stories", from a newsletter "Back to newsletter", from a podcast "Back to podcast". The list's filters, search, sort, page and page size are in its URL already, so the path and search carry them all. A page opened without it (a bookmark, a typed URL) goes back to `/admin/stories`, the list's defaults.
- **Where stories open.** On the list, the title is a real link (a new tab or a copied address works) and the Edit buttons go to the same place; elsewhere the newsletter's and the legacy podcast's assigned stories (`AssignedStoriesList`) and the newsletter's "Newer coverage" links (`NewerCoverageNote`) already link to the page and now carry their return. Nothing else opened the panel.
- **Old `?open=<id>` links** to the list go to the story's page in place of the list entry (replace), with the list's other parameters as the way back. The list never kept the panel in the URL, so this only catches links written by hand or by the other panels' pattern.
- **Scroll position.** `<main>` is the admin's scroll box, which today keeps its offset across pages. A small admin-wide rule (`useAdminScroll`, in `AdminLayout`): each history entry's scroll offset is remembered (in memory, and in `sessionStorage` across a reload); a link to another path starts at the top; browser Back or Forward puts the entry's offset back; the "Back to X" link puts back the offset of the entry it returns to (`restoreScrollOf` in its state). A restore waits up to 2 seconds for the page to be tall enough (the list's rows may still be loading) and stops when the person scrolls first. A change of the search alone (a filter, a page) keeps the offset as today.
- **Unsaved edits.** The guard is the hook's: the back link, Cancel, the sidebar and browser Back are navigations to another path, so they ask while edits are unsaved.

### Decisions settled here

- Location state over URL parameters for the return: the list's URL already carries its state, and a return parameter would clutter every story address; a bookmark of the page needs none.
- Save returns to the list (the panel's behavior), rather than staying on the page.
- Scroll is restored for every admin page, not the stories list alone: one rule in the layout is simpler than a list-only one, and the carried-over offset is wrong everywhere.
- In-memory and `sessionStorage` offsets keyed by history entry, no React Router `ScrollRestoration` (it restores the window, and the admin scrolls `<main>`).
- No new links from the clusters page to stories (it never opened the story panel); noted as follow-up work.

## Changes

| File | Change |
|---|---|
| `client/src/pages/admin/StoryDetailPage.tsx` | The page: back link from the return, h1, not-found, two-column form, social drafts |
| `client/src/components/admin/StoryEditForm.tsx` | Page only: two columns, cards, h2 sections, sticky bar; `variant` and panel imports removed |
| `client/src/components/admin/StoryDetail.tsx` | Deleted (the panel) |
| `client/src/components/admin/storyReturn.ts` (new) | `returnState`, `backLink`, the labels |
| `client/src/hooks/useAdminScroll.ts` (new) | The scroll rule for `<main>` |
| `client/src/layouts/AdminLayout.tsx` | `<main>` ref and `useAdminScroll` |
| `client/src/components/admin/social/useSocialDrafts.tsx` (new) | The two draft panels' state, handlers and elements |
| `client/src/pages/admin/StoriesPage.tsx` | Panel removed; stories open the page with their return; `?open=` redirect; social drafts through the hook |
| `client/src/components/admin/StoryTable.tsx` | Title as a link with the return state |
| `client/src/components/admin/AssignedStoriesList.tsx`, `NewerCoverageNote.tsx` | Links carry their return |
| `client/src/components/admin/StoryResearch.tsx`, `StoryContextAdmin.tsx`, `ResearchRunView.tsx`, `ContextRunView.tsx` | Heading levels up one |
| Docs | `.context/admin-dashboard.md` (route, the story page, the way back and scroll, the guard bullet, the panel mentions), `CLAUDE.md` ("Admin side panels") |

## Tests

- `storyReturn`: the label by the page opened from; the back link from a return, and the default for missing or malformed state.
- `useAdminScroll`'s decision: Back/Forward restores the entry's offset, the back link restores the named entry's, a new path goes to the top, a search change keeps it; the restore waits for height and gives up when the person scrolls.
- `useSocialDrafts`: generating opens the panel empty and shows the draft; a failure closes it with an error toast; publishing closes it and reports.
- `StoryDetailPage`: the back link returns to the list with its search; the default without a return; Save returns there; the back link asks while edits are unsaved; 404 shows not found.
- `StoriesPage`: `?open=<id>` lands on the page, its back link keeping the other parameters.
- `StoryTable`: the title links to the story's page.

## Out of Scope

- Links from the clusters page's members to their story pages.
- Deleting a story from its page (the panel had no delete).
- Previous and next story buttons on the page.

## Outcome

Implemented as planned, with these additions: the source, cluster and social sections moved out of `StoryEditForm` into `StoryEditorSections.tsx` and the card classes into `storyEditorClasses.ts`, so the form keeps one responsibility; the sticky bar classes moved from `PodcastActionBar` to `stickyActionBar.ts`, shared by both bars; `useSocialDrafts`' types replace `storyBulkActions`' copies. Found while verifying in the browser: a rating typed back to its saved value still counted as an unsaved edit (the form compared a number with the field's text), fixed by keeping the ratings as text in the form. Tests for the stories list, the editor's sections and every field's save raised client coverage to 84.27, 82.72, 74.46, 84.98, and the floor with it (84, 82, 74, 84).

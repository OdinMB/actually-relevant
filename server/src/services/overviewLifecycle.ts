/**
 * The only writer of the four overview tables (`overviews`, `overview_entries`, `overview_stands`,
 * `overview_decisions`; a fence test holds it to this module and its folder,
 * `test/overviewWriters.test.ts`; `.context/overviews.md`, "Records"). Every write is a plan of the
 * write model (`overviewChanges.ts`), made by pure code from the overview's rows read and locked in the
 * same transaction, and applied by one applier (`overviewLifecycle/apply.ts`), which logs it as its
 * decision with the change set Undo inverts:
 * - one story's linking (`applyLink`; plans in `overviewPlans.ts`): the join, the founding, the story
 *   left alone, or a conflict;
 * - the upkeep after linking (`applyClosing`, `applyStatus`, `applyBurst`, `applyRecenter`,
 *   `applyReview`, `applyAudit`; the same planners), and the stands refreshes (`applyStands`), which
 *   change no overview row;
 * - an editor's action and Undo (`editorAction`, `undoDecision`; plans in `overviewEdits.ts`).
 * Each change is applied only while its row still holds `before`, so a change made meanwhile is never
 * overwritten. A write that takes a public link away empties the public caches holding links once it
 * commits (`forgetOverviewLinks`).
 */
export { PIPELINE, REVIEWER } from './overviewPlans.js'
export { applyLink } from './overviewLifecycle/linking.js'
export { applyAudit, applyBurst, applyClosing, applyRecenter, applyReview, applyStands, applyStatus, type StandsRecord } from './overviewLifecycle/upkeep.js'
export { editorAction, undoDecision } from './overviewLifecycle/editor.js'

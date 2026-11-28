/**
 * The stands gate (`.context/overviews.md`, "Where this stands" and "How the switch stays off";
 * ADR-0084): why no overview's "Where this stands" is written or served, whatever the settings,
 * while overviews themselves may run. Overviews ship as a timeline of our stories (the owner,
 * 2026-11-28); the stands come later, once their own evals meet their bars (the `stands` step's,
 * `fact-check --facts stands`, and the `pass-pool` evidence they rest on) and research passes run,
 * since the stands are written from the facts passes check. While it is set the upkeep's part 4
 * does not run (no stands decision, no version written or superseded), and no public read serves a
 * stands line, its sources, its part of the AI marker or its time as a last change. The change that
 * switches the stands on sets it to null; a module of its own, so a test can open it (`vi.mock`)
 * and nothing at run time can.
 */
export const OVERVIEW_STANDS_GATE: string | null =
  'their evals (stands, fact-check --facts stands and the pass-pool evidence) have not yet met their bars, and they also need research passes\' checked facts, so they wait until research passes are on (.context/overviews.md, "Where this stands")'

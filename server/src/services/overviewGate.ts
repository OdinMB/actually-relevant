/**
 * The overview step's eval gate (`.context/overviews.md`, "How the switch stays off" and "Switching
 * on"; ADR-0070, ADR-0084): why `link_overviews` may not run or be switched on, whatever the settings,
 * until its evals meet their bars. Open (null) since 2026-11-28: every overview bar is met or accepted
 * by the owner (`.context/eval-baselines.md`), who signed off the re-center bar that day, and
 * overviews ship as a timeline of our stories without waiting for research passes (ADR-0084). The
 * owner switches them on by enabling the job on the Jobs page; until then no story is linked and
 * readers see none. "Where this stands" keeps a gate of its own (`overviewStandsGate.ts`). Setting a
 * reason here again switches the step off and refuses enabling it. A module of its own, so a test
 * can close or open the gate (`vi.mock`) and nothing at run time can.
 */
export const OVERVIEW_EVAL_GATE: string | null = null

/**
 * The overview step's eval gate (`.context/overviews.md`, "How the switch stays off" and "Switching
 * on"; ADR-0070): why `link_overviews` may not run or be switched on, whatever the settings, until its
 * evals meet their bars. The change that switches overviews on (plan phase 6, after research passes
 * are on) sets it to null, and is the only code change the switch needs: the owner then enables the
 * job on the Jobs page. Until then no story is linked in production and enabling the job is refused.
 * A module of its own, so a test can open the gate (`vi.mock`) and nothing at run time can.
 */
export const OVERVIEW_EVAL_GATE: string | null =
  'their evals have not yet met the plan\'s bars, and the owner switches them on once research passes are on (.context/overviews.md, "Switching on")'

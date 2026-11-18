/**
 * The research pass step's eval gate (`.context/research-passes.md`, "How the switch stays off";
 * ADR-0066, plan "Evals and the gate"): why the step may not run or be switched on, whatever the
 * settings, until its evals meet their bars. The change that switches the step on (plan phase 6) sets
 * it to null; until then no pass runs in production, enabling the job is refused, the publish gate
 * holds nothing for it, and editors' passes are refused. A module of its own, so a test can open the
 * gate (`vi.mock`) and nothing at run time can.
 */
export const PASS_EVAL_GATE: string | null =
  'their evals have not yet met the plan\'s bars, and the owner switches them on once they do (.context/research-passes.md, "How the switch stays off")'

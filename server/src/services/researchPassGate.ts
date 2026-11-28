/**
 * The research pass step's eval gate (`.context/research-passes.md`, "How the switch stays off";
 * ADR-0066, plan "Evals and the gate", ADR-0083): why the step may not run or be switched on, whatever
 * the settings, until its evals meet their bars: `eval:research`'s (no regression against research's
 * baseline) and the `update` step's. The cards' bars (the `context` step's) are the card gate's
 * (`cardGate.ts`), which keeps a pass's cards from readers and holds nothing here (the owner,
 * 2026-11-28). The change that switches the step on (plan phase 6) sets it to null; until then no pass
 * runs in production, enabling the job is refused, the publish gate holds nothing for it, and editors'
 * passes are refused. A module of its own, so a test can open the gate (`vi.mock`) and nothing at run
 * time can.
 */
export const PASS_EVAL_GATE: string | null =
  'their research and update evals have not yet met their bars, and the owner switches them on once they do (.context/research-passes.md, "How the switch stays off")'

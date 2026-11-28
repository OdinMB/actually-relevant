/**
 * The card gate (`.context/research-passes.md`, "The cards a pass writes" and "How the switch stays
 * off"; ADR-0083): why readers see none of the cards a research pass wrote, whatever the settings,
 * until the cards' own evals (the `context` step's bars, `.context/model-eval.md`) meet their bars.
 * Research passes' gate (`researchPassGate.ts`) no longer waits for them (the owner, 2026-11-28): a
 * pass may run and write its cards while this is closed, and the admin shows them marked hidden from
 * readers. It holds back no context run's cards and no switch. The change that opens the cards to
 * readers sets it to null; a module of its own, so a test can open it (`vi.mock`) and nothing at run
 * time can.
 */
export const CARD_EVAL_GATE: string | null =
  'their evals have not yet met their bars, and the owner opens them to readers once they do (.context/research-passes.md, "The cards a pass writes")'

/**
 * The task spend cap as an eval command takes it (`--cap <name>` or `EVAL_SPEND_CAP`;
 * `.context/model-eval.md`, "Spend: the task cap and the folder budget"): installed once, before the
 * command sends anything, so every OpenAI and Tavily request it makes passes through it, production's
 * pipeline code in its sandboxes included (`lib/spendCap.ts`). Without a name, the guard that refuses
 * every live paid request, so a cached, dry, cache-only or rescore run needs no cap. Also the console
 * line and report section that say what the command spent and what is left, and `eval:cap show`'s.
 */
import { fileURLToPath } from 'node:url'
import { installSpendGuard, NO_CAP, openCap, type CapState } from '../../lib/spendCap.js'

/** Where the caps live: the repository's gitignored `DOCS/`, beside the eval folders, whatever the working directory. */
export const CAP_DIR = fileURLToPath(new URL('../../../../DOCS/eval-caps/', import.meta.url))

const usd = (v: number) => `$${v.toFixed(4)}`
const NONE =
  'none: a live OpenAI or Tavily request is refused (create a cap with `npm run eval:cap --prefix server -- new <name> --usd <n>`, then pass `--cap <name>`)'

export interface EvalCap {
  /** One console line: the cap, what this command spent, and what is left. */
  line(): string
  /** The same as a report section, for the end of the command's report. */
  section(): string
  /** Give the cap up; reservations still open stay counted in full. Also done at exit. */
  close(): void
}

/** Install the command's spend guard: the cap `name`, refused while another live process uses it, or the no-cap guard. */
export function installEvalCap(name: string | undefined, dir: string = CAP_DIR): EvalCap {
  if (name === undefined) {
    installSpendGuard(NO_CAP)
    return { line: () => `spend cap: ${NONE}`, section: () => `\n## Spend cap\n\n${NONE}\n`, close: () => {} }
  }
  const cap = openCap(dir, name)
  try {
    installSpendGuard(cap)
  } catch (err) {
    cap.close()
    throw err
  }
  process.once('exit', () => cap.close())
  const left = (s: CapState) => `${usd(s.remainingUsd)} (settled ${usd(s.settledUsd)}, open ${usd(s.openUsd)} in ${s.openCount} reservations)`
  return {
    line() {
      const s = cap.state()
      return `spend cap ${name}: ${usd(s.capUsd)}; this command ${usd(cap.spentHereUsd())}; left ${left(s)}`
    },
    section() {
      const s = cap.state()
      return [
        '',
        '## Spend cap',
        '',
        `- Cap \`${name}\`: ${usd(s.capUsd)}, created ${s.createdAt}`,
        `- This command: ${usd(cap.spentHereUsd())}`,
        `- Left: ${left(s)}`,
        '',
      ].join('\n')
    },
    close: () => cap.close(),
  }
}

/** What `eval:cap` prints of a cap. */
export function describeCap(s: CapState & { inUseBy: number | null }): string[] {
  return [
    `cap ${s.name}: ${usd(s.capUsd)}, created ${s.createdAt}; its amount never changes`,
    `settled: ${usd(s.settledUsd)}`,
    `open reservations: ${s.openCount}, ${usd(s.openUsd)} (requests in flight, or left by a process that ended before they did: counted in full)`,
    `left: ${usd(s.remainingUsd)}`,
    s.inUseBy === null ? 'not in use' : `in use by process ${s.inUseBy}`,
  ]
}

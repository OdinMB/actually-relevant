/**
 * eval:cap: create a task spend cap, or show what is left of one (`.context/model-eval.md`, "Spend:
 * the task cap and the folder budget"). Every eval command that sends a live paid request needs one
 * (`--cap <name>`); several commands of one task share a cap, one after another.
 *
 *   npm run eval:cap --prefix server -- new cloud-2026-11-26 --usd 5
 *   npm run eval:cap --prefix server -- show cloud-2026-11-26
 *
 * A cap's amount is fixed when it is created (at most `MAX_BUDGET_USD`): a bigger budget is a new cap.
 * The caps live in the repository's gitignored `DOCS/eval-caps/`. Needs no database and no key.
 */
import { createCap, readCap } from '../../lib/spendCap.js'
import { parseCapCommand } from './options.js'
import { CAP_DIR, describeCap } from './taskCap.js'

function main(): void {
  const command = parseCapCommand(process.argv.slice(2))
  if (command.command === 'new') createCap(CAP_DIR, command.name, command.usd)
  for (const line of describeCap(readCap(CAP_DIR, command.name))) console.log(line)
}

try {
  main()
} catch (err) {
  console.error(`eval:cap failed: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}

/**
 * The Dashboard's spending overview (`.context/scheduler.md`, "Spending"): this month's spend per job,
 * research started by an editor and in total, with the two months before, and setting or clearing a
 * scope's monthly warning level. 400 for a level that is not a whole number of dollars of at least 1,
 * and for a scope that counts no spending (setSpendWarning's BadRequestError).
 */
import { Router } from 'express'
import { validateBody } from '../../middleware/validate.js'
import { failsWith } from '../../middleware/routeErrors.js'
import { spendWarningSchema } from '../../schemas/spending.js'
import { getSpendingOverview, setSpendWarning } from '../../services/spending.js'

const router = Router()

router.get('/', failsWith('Failed to fetch spending'), async (_req, res) => {
  res.json(await getSpendingOverview())
})

router.put('/warnings/:scope', failsWith('Failed to save the warning level'), validateBody(spendWarningSchema), async (req, res) => {
  const scope = req.params.scope!
  const { levelUsd } = req.body as { levelUsd: number | null }
  await setSpendWarning(scope, levelUsd)
  res.json({ scope, levelUsd })
})

export default router

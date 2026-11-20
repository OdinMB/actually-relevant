/**
 * Ongoing-story overviews, the admin's endpoints (`.context/overviews.md`, "Admin"): whether the step
 * is on and how many overviews exist, the list, one overview with its entries, stands and decision
 * log, a story's Overview block, an editor's actions (attach, detach, role, retitle, re-center, freeze,
 * hide, close or reopen) and Undo of one decision. Every write goes through the lifecycle module and is
 * logged as the editor's decision; each answers `{ decisionId }`. Refusals are the services'
 * ServiceErrors: 404 for an unknown overview, entry, story or decision, 409 for an action that would
 * change nothing or whose rows changed since, with the reason.
 */
import { Router, type Request } from 'express'
import { z } from 'zod'
import { config } from '../../config.js'
import { failsWith } from '../../middleware/routeErrors.js'
import { validateBody, validateQuery } from '../../middleware/validate.js'
import type { EditorAction } from '../../services/overviewEdits.js'
import { editorAction, undoDecision } from '../../services/overviewLifecycle.js'
import { ENTRY_ROLES, OVERVIEW_SCOPES, OVERVIEW_STATUSES, ROLE_KINDS, type Role } from '../../services/overviewTypes.js'
import { adminOverview, adminOverviewList, overviewsAdminState, storyOverview } from '../../services/overviewViews.js'

const router = Router()

const flag = z.enum(['true', 'false']).transform(v => v === 'true')
const listQuerySchema = z.object({
  scope: z.enum(OVERVIEW_SCOPES).optional(),
  status: z.enum(OVERVIEW_STATUSES).optional(),
  frozen: flag.optional(),
  hidden: flag.optional(),
})

/** A role as an editor sets it: a turning point names its kind, a routine entry has none. */
const roleSchema = z
  .object({ role: z.enum(ENTRY_ROLES), roleKind: z.enum(ROLE_KINDS).nullable().default(null) })
  .refine(r => r.role === 'routine' || r.roleKind !== null, { message: 'A turning point needs its kind', path: ['roleKind'] })
  .transform((r): Role => ({ role: r.role, roleKind: r.role === 'routine' ? null : r.roleKind }))

const attachSchema = z.object({ storyId: z.string().uuid(), role: roleSchema.default({ role: 'routine', roleKind: null }) })
const title = z.string().trim().min(1).max(config.overviews.maxTitleChars)
const titleSchema = z.object({ title })
/**
 * An editor's re-center: the title and the whole charter, END_EVENT null for none (a named one not
 * blank), the anchor confirmed, and the title and charter the form was opened on (`basedOn`, as the
 * page read them), so a change made since is refused rather than overwritten.
 */
const charterSchema = z.object({
  title,
  in: z.string().trim().min(1),
  out: z.array(z.string().trim().min(1).max(config.overviews.maxOutChars)).max(config.overviews.maxOutEntries),
  endEvent: z.string().trim().min(1).nullable(),
  anchorConfirmed: z.boolean(),
  basedOn: z.object({ title: z.string(), charter: z.object({ in: z.string(), out: z.array(z.string()), endEvent: z.string().nullable() }) }),
})
const frozenSchema = z.object({ frozen: z.boolean() })
const hiddenSchema = z.object({ hidden: z.boolean() })
const closedSchema = z.object({ closed: z.boolean() })

const editor = (req: Request) => req.user!.userId
const act = async (req: Request, action: EditorAction) => editorAction(action, editor(req))

router.get('/state', failsWith('Failed to fetch the overviews state'), async (_req, res) => {
  res.json(await overviewsAdminState())
})

router.get('/', failsWith('Failed to list overviews'), validateQuery(listQuerySchema), async (req, res) => {
  res.json(await adminOverviewList(req.parsedQuery))
})

router.get('/stories/:storyId', failsWith("Failed to fetch the story's overview"), async (req, res) => {
  res.json(await storyOverview(req.params.storyId!))
})

router.post('/decisions/:decisionId/undo', failsWith('Failed to undo the decision'), async (req, res) => {
  res.json(await undoDecision(req.params.decisionId!, editor(req)))
})

router.get('/:id', failsWith('Failed to fetch the overview'), async (req, res) => {
  res.json(await adminOverview(req.params.id!))
})

router.post('/:id/entries', failsWith('Failed to attach the story'), validateBody(attachSchema), async (req, res) => {
  res.status(201).json(await act(req, { kind: 'attach', overviewId: req.params.id!, storyId: req.body.storyId, role: req.body.role }))
})

router.post('/:id/entries/:entryId/detach', failsWith('Failed to detach the entry'), async (req, res) => {
  res.json(await act(req, { kind: 'detach', overviewId: req.params.id!, entryId: req.params.entryId! }))
})

router.put('/:id/entries/:entryId/role', failsWith('Failed to set the role'), validateBody(roleSchema), async (req, res) => {
  res.json(await act(req, { kind: 'role', overviewId: req.params.id!, entryId: req.params.entryId!, role: req.body }))
})

router.put('/:id/title', failsWith('Failed to retitle the overview'), validateBody(titleSchema), async (req, res) => {
  res.json(await act(req, { kind: 'retitle', overviewId: req.params.id!, title: req.body.title }))
})

router.put('/:id/charter', failsWith('Failed to re-center the overview'), validateBody(charterSchema), async (req, res) => {
  const { title, in: within, out, endEvent, anchorConfirmed, basedOn } = req.body
  res.json(await act(req, { kind: 'recenter', overviewId: req.params.id!, title, charter: { in: within, out, endEvent }, anchorConfirmed, basedOn }))
})

router.put('/:id/frozen', failsWith('Failed to change the freeze'), validateBody(frozenSchema), async (req, res) => {
  res.json(await act(req, { kind: 'freeze', overviewId: req.params.id!, frozen: req.body.frozen }))
})

router.put('/:id/hidden', failsWith('Failed to change whether the overview is hidden'), validateBody(hiddenSchema), async (req, res) => {
  res.json(await act(req, { kind: 'hide', overviewId: req.params.id!, hidden: req.body.hidden }))
})

router.put('/:id/closed', failsWith('Failed to close or reopen the overview'), validateBody(closedSchema), async (req, res) => {
  res.json(await act(req, { kind: 'close', overviewId: req.params.id!, closed: req.body.closed }))
})

export default router

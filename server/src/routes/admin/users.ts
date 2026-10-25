import { Router } from 'express'
import * as userService from '../../services/user.js'
import { revokeAllUserTokens } from '../../services/auth.js'
import { validateBody } from '../../middleware/validate.js'
import { requireRole } from '../../middleware/auth.js'
import { failsWith } from '../../middleware/routeErrors.js'
import { createUserSchema, updateUserSchema } from '../../schemas/user.js'
import { resetPasswordSchema } from '../../schemas/auth.js'

const router = Router()
const userErrors = { notFound: 'User not found', duplicate: 'A user with this email already exists' }

// All user management requires admin role
router.use(requireRole('admin'))

router.get('/', failsWith('Failed to list users'), async (_req, res) => {
  res.json(await userService.listUsers())
})

router.get('/:id', failsWith('Failed to get user'), async (req, res) => {
  const user = await userService.getUserById(req.params.id!)
  if (!user) {
    res.status(404).json({ error: 'User not found' })
    return
  }
  res.json(user)
})

router.post('/', failsWith('Failed to create user', userErrors), validateBody(createUserSchema), async (req, res) => {
  res.status(201).json(await userService.createUser(req.body))
})

router.put('/:id', failsWith('Failed to update user', userErrors), validateBody(updateUserSchema), async (req, res) => {
  res.json(await userService.updateUser(req.params.id!, req.body))
})

// An admin sets another user's password; a user changes their own with PUT /api/auth/password
router.put('/:id/password', failsWith('Failed to reset password', userErrors), validateBody(resetPasswordSchema), async (req, res) => {
  await userService.resetPassword(req.params.id!, req.body.password)
  res.json({ message: 'Password reset' })
})

router.delete('/:id', failsWith('Failed to delete user', userErrors), async (req, res) => {
  if (req.user?.userId === req.params.id!) {
    res.status(400).json({ error: 'Cannot delete your own account' })
    return
  }
  await revokeAllUserTokens(req.params.id!)
  await userService.deleteUser(req.params.id!)
  res.status(204).send()
})

export default router

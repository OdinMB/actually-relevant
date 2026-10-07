import { ConfirmDialog } from '../ui/ConfirmDialog'
import type { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard'

interface UnsavedChangesDialogProps {
  leave: ReturnType<typeof useUnsavedChangesGuard>
  description?: string
}

/** The one confirm dialog of a page's `useUnsavedChangesGuard`. */
export function UnsavedChangesDialog({
  leave,
  description = 'Your changes have not been saved. Leaving discards them.',
}: UnsavedChangesDialogProps) {
  return (
    <ConfirmDialog
      open={leave.asking}
      onClose={leave.cancel}
      onConfirm={leave.confirm}
      title="Discard your unsaved changes?"
      description={description}
      variant="danger"
      confirmLabel="Discard changes"
    />
  )
}

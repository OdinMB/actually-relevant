import { Button } from '../ui/Button'
import { PANEL_FOOTER } from './EditPanel'

interface PanelFooterProps {
  isPending: boolean
  isDirty: boolean
  onCancel: () => void
  /** Why Save is off, shown beside it and read with it (e.g. a confirmation still to tick). */
  hint?: string | null
}

export function PanelFooter({ isPending, isDirty, onCancel, hint }: PanelFooterProps) {
  return (
    <div className={PANEL_FOOTER}>
      <Button type="submit" loading={isPending} disabled={!isDirty} aria-describedby={hint ? 'panel-footer-hint' : undefined}>
        Save
      </Button>
      <Button type="button" variant="secondary" onClick={onCancel}>
        Cancel
      </Button>
      {hint && (
        <p id="panel-footer-hint" className="self-center text-xs text-neutral-500">
          {hint}
        </p>
      )}
    </div>
  )
}

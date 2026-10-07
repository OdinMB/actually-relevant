import type { ComponentProps } from 'react'
import { Button } from './Button'
import { Tooltip } from './Tooltip'

type ReasonButtonProps = Omit<ComponentProps<typeof Button>, 'disabled'> & {
  /** Why the action is not possible now; null or empty when it is. */
  reason: string | null
  placement?: 'top' | 'bottom'
  align?: 'start' | 'end'
}

/**
 * A button that, while `reason` is set, stays visible and focusable but does nothing
 * (`aria-disabled`), and says why in a tooltip that is also its accessible description. Used where
 * an action must never disappear without an explanation.
 */
export function ReasonButton({ reason, placement = 'top', align = 'start', onClick, className = '', ...props }: ReasonButtonProps) {
  if (!reason) return <Button onClick={onClick} className={className} {...props} />
  return (
    <Tooltip content={reason} placement={placement} align={align}>
      {trigger => (
        <Button
          {...props}
          {...trigger}
          aria-disabled="true"
          onClick={e => e.preventDefault()}
          className={`opacity-50 cursor-not-allowed ${className}`}
        />
      )}
    </Tooltip>
  )
}

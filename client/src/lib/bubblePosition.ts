/**
 * Where a floating bubble goes beside the control that opens it, in viewport coordinates (for
 * `position: fixed`, which no scrolling or clipping container cuts off): below the control when it
 * fits, else above when it fits there, else on the side with more room; at the control's left edge,
 * moved left to stay inside the viewport. The bubble's own padding makes the gap to the control.
 */
export interface BubblePosition {
  side: 'below' | 'above'
  top: number
  left: number
}

/** Space kept between the bubble and the viewport's edges, in px. */
const MARGIN = 8

export function bubblePosition(
  trigger: { top: number; bottom: number; left: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): BubblePosition {
  const roomBelow = viewport.height - MARGIN - trigger.bottom
  const roomAbove = trigger.top - MARGIN
  const side = size.height <= roomBelow || roomBelow >= roomAbove ? 'below' : 'above'
  return {
    side,
    top: side === 'below' ? trigger.bottom : trigger.top - size.height,
    left: Math.max(MARGIN, Math.min(trigger.left, viewport.width - MARGIN - size.width)),
  }
}

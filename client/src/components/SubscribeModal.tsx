import ModalDialog from './ModalDialog'
import SubscribeForm from './SubscribeForm'

interface SubscribeModalProps {
  open: boolean
  onClose: () => void
}

/** The newsletter signup dialog. */
export default function SubscribeModal({ open, onClose }: SubscribeModalProps) {
  return (
    <ModalDialog open={open} onClose={onClose} title="Stay informed">
      <SubscribeForm autoFocus onSuccess={onClose} onPastIssuesClick={onClose} idPrefix="subscribe-modal" />
    </ModalDialog>
  )
}

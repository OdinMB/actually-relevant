import ModalDialog from './ModalDialog'
import FeedbackForm, { type FeedbackStory } from './FeedbackForm'

interface FeedbackModalProps {
  open: boolean
  onClose: () => void
  /** The story a "Report an error" is about; general feedback without one */
  story?: FeedbackStory
}

/** The feedback dialog: a story's "Report an error", or general feedback. */
export default function FeedbackModal({ open, onClose, story }: FeedbackModalProps) {
  return (
    <ModalDialog open={open} onClose={onClose} title={story ? 'Report an error' : 'Send feedback'}>
      <FeedbackForm key={story?.id ?? ''} autoFocus onSuccess={onClose} idPrefix="feedback-modal" story={story} />
    </ModalDialog>
  )
}

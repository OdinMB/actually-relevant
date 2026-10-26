import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import FeedbackModal from './FeedbackModal'
import type { FeedbackStory } from './FeedbackForm'

interface FeedbackContextValue {
  /** Open the feedback dialog; with a story, as that story's "Report an error". */
  openFeedback: (story?: FeedbackStory) => void
}

const FeedbackContext = createContext<FeedbackContextValue>({
  openFeedback: () => {},
})

export const useFeedback = () => useContext(FeedbackContext)

export default function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const [story, setStory] = useState<FeedbackStory | undefined>(undefined)

  const openFeedback = useCallback((next?: FeedbackStory) => {
    setStory(next)
    setOpen(true)
  }, [])
  const value = useMemo(() => ({ openFeedback }), [openFeedback])

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <FeedbackModal open={open} story={story} onClose={() => setOpen(false)} />
    </FeedbackContext.Provider>
  )
}

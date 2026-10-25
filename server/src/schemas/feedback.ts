import type { FeedbackCategory } from '@prisma/client'

/** Every `FeedbackCategory` the schema knows; `correction` is a "Report an error" from a story page. */
export const FEEDBACK_CATEGORIES = ['general', 'bug', 'suggestion', 'other', 'correction'] as const satisfies readonly FeedbackCategory[]

/**
 * Visible AI disclosure copy (EU AI Act Art. 50(4)/(5)), as approved by the owner on
 * 2026-09-25 (label copy review, items ACR-1 to ACR-4, ACR-8, ACR-13). Change wording
 * here, not at the call sites, and update .context/ai-transparency.md in the same change.
 */
export const AI_DISCLOSURE_COPY = {
  /** Visible main element of every label; the EU icons use "AI" too. */
  badgeText: 'AI',
  /** What screen readers announce for a standalone badge on AI-generated content. */
  badgeAccessibleName: 'AI-generated',
  /** Accessible name of the badge on a pull quote: a real person's words that AI picked, not AI text. */
  quoteBadgeAccessibleName: 'Selected by AI',
  /** Follows the attribution of every AI-selected quote. */
  quoteNote: 'selected and potentially translated by AI',
  /**
   * Second micro-line under the header claim on every public page, linking to howItWorksHref
   * (owner-approved 2026-10-07; replaced the band "Written and curated with care by AI.").
   */
  headerAiLine: 'Written & curated by AI',
  /** What screen readers announce for the header AI line, which is a link to the explainer. */
  headerAiLineAccessibleName: 'Written and curated by AI: how it works',
  /** Link after the story page's AI label. */
  howItWorksLinkText: 'How it works',
  howItWorksHref: '/methodology',
  /** Label in the story page's metadata row. */
  storyLabel: 'AI-generated summary and analysis',
  /** Header of the /embed iframe (widget.js carries the same line). */
  embedHeader: 'AI-generated headlines from Actually Relevant',
  /** Appended to the AI blurb that the share buttons prefill. */
  shareSuffix: '(AI summary via Actually Relevant)',
  /** Label at the top of the /podcast page (owner-approved 2026-10-06, plan open question 1). */
  podcastLabel: 'Written and voiced by AI.',
} as const

/** The attribution line under an AI-selected quote: "— {attribution} · {note}", or the note alone. */
export function quoteAttributionLine(attribution: string | null | undefined): string {
  const note = AI_DISCLOSURE_COPY.quoteNote
  if (attribution) return `— ${attribution} · ${note}`
  return note.charAt(0).toUpperCase() + note.slice(1)
}

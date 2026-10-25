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
   * Header AI line on every public page: a second line under the claim on phones, the same
   * line as the claim from md up. Links to howItWorksHref
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
  /**
   * Subtitle under the /podcast and transcript page headings. The "AI" badge stands inline between
   * lead and tail and is the subtitle's only "AI" (owner's request 2026-10-25; replaced the
   * 2026-10-07 subtitle, which led with the badge and said "AI" three more times).
   */
  podcastSubtitle: {
    lead: 'A weekly five-minute briefing on the news that matters most to humanity, written and voiced by',
    tail: ". Two hosts talk through a handful of the week's stories.",
  },
  /**
   * Subtitle under the /newsletter heading, modeled on podcastSubtitle: the "AI" badge stands
   * inline between lead and tail and is the subtitle's only "AI".
   * Owner-approved 2026-10-25 (added when the archive moved onto /newsletter).
   */
  newsletterSubtitle: {
    lead: 'A weekly email with the news that matters most to humanity, selected and written by',
    tail: ". Each issue sums up the week's most relevant stories.",
  },
} as const

/** The attribution line under an AI-selected quote: "— {attribution} · {note}", or the note alone. */
export function quoteAttributionLine(attribution: string | null | undefined): string {
  const note = AI_DISCLOSURE_COPY.quoteNote
  if (attribution) return `— ${attribution} · ${note}`
  return note.charAt(0).toUpperCase() + note.slice(1)
}

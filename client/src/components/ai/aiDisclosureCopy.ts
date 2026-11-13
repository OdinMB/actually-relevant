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
  /**
   * Follows the attribution of every AI-selected quote. Owner-approved 2026-11-01 (homepage
   * plain-language review), replacing "selected and potentially translated by AI". Used as
   * plain text where the quote line carries no badge (story page, homepage hero).
   */
  quoteNote: 'chosen by AI, may be translated',
  /**
   * The same note on pull quotes, where the "AI" badge stands inline between lead and tail and
   * is the line's only "AI" (owner's request 2026-11-05; before that the badge stood in front of
   * the attribution, announced "Selected by AI", and the note said "AI" again).
   */
  quoteNoteInline: {
    lead: 'chosen by',
    tail: ', may be translated',
  },
  /**
   * Header AI line on every public page: a second line under the claim on phones, the same
   * line as the claim from md up. The "AI" badge follows it and is the line's only "AI".
   * Links to howItWorksHref (owner-approved 2026-10-07, replacing the band "Written and
   * curated with care by AI."; badge moved from the front of the line to its end on 2026-10-28).
   */
  headerAiLine: 'Written & curated by',
  /** What screen readers announce for the header AI line, which is a link to the explainer. */
  headerAiLineAccessibleName: 'Written and curated by AI: how it works',
  /** Link after the story page's AI label. */
  howItWorksLinkText: 'How it works',
  howItWorksHref: '/methodology',
  /**
   * Label in the story page's metadata row: "Summary and analysis by [AI]." The "AI" badge stands
   * between lead and tail and is the label's only "AI" (owner's wording 2026-11-03, replacing
   * "[AI] AI-generated summary and analysis", which led with the badge).
   */
  storyLabel: {
    lead: 'Summary and analysis by',
    tail: '.',
  },
  /**
   * The same label on a researched story (one written from several sources, with citations):
   * "Researched and written by [AI]." Owner-approved 2026-11-12 (multi-source stories design,
   * "AI label"); stories in the single-source format keep storyLabel. On the story page its first
   * words, linkText, link to the methodology page's research section in place of "How it works"
   * (owner, 2026-11-13).
   */
  researchedStoryLabel: {
    lead: 'Researched and written by',
    tail: '.',
    linkText: 'Researched and written',
    href: '/methodology#researched-stories',
  },
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
   * Prefix of the transcript page's description and og:description, in front of the AI episode
   * summary; the 160 and 200 character cuts apply to the whole string. The backend's link preview
   * uses the same prefix (PODCAST_TRANSCRIPT_DESCRIPTION_PREFIX in server/src/lib/aiLabelCopy.ts).
   * Approved by Odin Mühlenbein in session, 2026-11-05.
   */
  podcastTranscriptDescriptionPrefix: 'AI: ',
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

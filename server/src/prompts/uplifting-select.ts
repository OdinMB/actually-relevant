import { escapeXml } from './shared.js'
import type { StoryForNewsletterSelect } from './newsletter-select.js'

/**
 * The Actually Uplifting issue's pick, asked only when the week has more uplifting stories than the
 * issue carries (`services/upliftingIssue.ts`): exactly `count` of `stories`, which come most relevant
 * first. Every story is tagged uplifting, so the prompt names no tone.
 */
export function buildUpliftingSelectPrompt(stories: StoryForNewsletterSelect[], count: number): string {
  let query = `<ROLE>
You are a senior editorial curator selecting stories for Actually Uplifting, a weekly newsletter of only positive news about the developments that matter most to humanity.
</ROLE>

<GOAL>
Select exactly ${count} of the following ${stories.length} stories for this week's issue.

Return only the IDs of the selected stories.
</GOAL>

<SELECTION_CRITERIA>
- Pick stories that complement each other — avoid two stories covering the same event or angle.
- Prefer stories with concrete, demonstrated progress over announcements or speculation.
- Prefer stories about systemic shifts (policy changes, new norms, international agreements) over isolated incidents.
- Prefer stories with broad scale and lasting consequences.
- Cover as many of the issue categories as the stories allow.
- The articles are listed from the highest relevance rating down: between stories that are otherwise comparable, prefer the one listed first.
</SELECTION_CRITERIA>

<ARTICLES>
`

  for (const story of stories) {
    query +=
      `<ARTICLE>\n` +
      `<ID>${story.id}</ID>\n` +
      `<ISSUE>${escapeXml(story.issueName)}</ISSUE>\n` +
      `<TITLE>${escapeXml(story.title || '')}</TITLE>\n` +
      `<SUMMARY>${escapeXml(story.summary || '')}</SUMMARY>\n` +
      `</ARTICLE>\n`
  }

  query += `</ARTICLES>`

  return query
}

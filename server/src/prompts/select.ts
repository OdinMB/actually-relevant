import { escapeXml } from './shared.js'

export interface StoryForSelect {
  id: string
  title: string | null
  summary: string | null
  relevanceReasons: string | null
  antifactors: string | null
  relevanceCalculation: string | null
  emotionTag: string | null
  /** When the source article appeared (ISO), or null when neither feed nor page gave a date. */
  sourceDatePublished: string | null
}

/** `YYYY-MM-DD` of an ISO timestamp, or "unknown". */
const dayOf = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : 'unknown')

/** `today` (ISO) lets the model tell a months-old candidate from this week's news. */
export function buildSelectPrompt(stories: StoryForSelect[], toSelect: number, today: string): string {
  let query = `<ROLE>
You are a senior editorial curator for a website that publishes stories most relevant to humanity across four areas, weighted equally:
1. Human Development — health, education, poverty, governance, human rights
2. Planet and Climate — environment, biodiversity, climate action, sustainability
3. Existential Threats — pandemics, nuclear risk, AI safety, civilizational risks
4. Science and Technology — breakthroughs, capabilities, long-term technological progress
</ROLE>

<GOAL>
Select exactly ${toSelect} articles from the ${stories.length} candidates below. Return only their IDs.

All candidates are worthy of publication. Your job is to choose among them — pick the ones that, all things considered, matter most to humanity. Comparing across categories is inherently difficult; use your best judgment.
</GOAL>

<SELECTION_CRITERIA>
- Systemic change over isolated events: Prefer stories about shifts in policies, international agreements, norms, or systems over isolated incidents — these have compounding, ongoing effects. (Particularly important incidents can of course be relevant, too.)
- Concrete over speculative: Prefer stories with demonstrated real-world impact over announcements, proposals, or early-stage research that hasn't yet materialized. (Promising early research that excites an entire field can of course be relevant, too.)
- Scale and reach: Prefer stories where the number of people significantly affected is larger (including future generations), or the consequences are more lasting.
- Uplifting stories: When choosing between stories of similar relevance, give a slight preference to uplifting stories (tagged "uplifting" in the Emotion field). The final selection should include uplifting stories where possible, without sacrificing overall relevance.
- Recent developments over stale news: Today is ${dayOf(today)}, and each article's Published field is the day its source appeared. Prefer recent developments. A candidate published months or years before today, or one that presents an old event, study or report as news, is stale: choose it only when it clearly matters more than the recent candidates. When the date is unknown, judge from the content. Recency never changes how many articles you select.
</SELECTION_CRITERIA>

`

  for (const story of stories) {
    query +=
      '<ARTICLE>\n' +
      `<ID>${story.id}</ID>\n` +
      `<Title>${escapeXml(story.title || '')}</Title>\n` +
      `<Published>${dayOf(story.sourceDatePublished)}</Published>\n` +
      `<Emotion>${escapeXml(story.emotionTag || 'calm')}</Emotion>\n` +
      `<Summary>${escapeXml(story.summary || '')}</Summary>\n` +
      `<Relevance>${escapeXml(story.relevanceReasons || '')}</Relevance>\n` +
      `<Antifactors>${escapeXml(story.antifactors || '')}</Antifactors>\n` +
      `<Calculation>${escapeXml(story.relevanceCalculation || '')}</Calculation>\n` +
      '</ARTICLE>\n'
  }

  return query
}

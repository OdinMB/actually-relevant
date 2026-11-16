/**
 * The jobs whose work includes model calls, so their Flex switch matters (services/openaiFetch.ts)
 * and the Dashboard's spending overview lists them even in a month they spent nothing
 * (services/spending.ts). The others make none (crawl, publish, metrics, sends) or only embeddings,
 * which never go at flex. No imports, so the job list and the spending overview can both read it.
 */
export const MODEL_JOBS: ReadonlySet<string> = new Set([
  'preassess_stories',
  'assess_stories',
  'select_stories',
  'research_stories',
  'social_auto_post',
  'generate_newsletter',
  'generate_uplifting_newsletter',
  'generate_podcast',
  'generate_uplifting_podcast',
])

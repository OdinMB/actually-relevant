/**
 * What must hold before a job may be enabled from the admin Jobs page. Most jobs need nothing; a
 * job whose every run would block on a missing setting is refused up front, naming the setting. The
 * research pass replaces research and story context (`.context/research-passes.md`, "The job and the
 * gate"): it is refused while its eval gate is closed, then without the key; enabling it switches the
 * two old steps off (`SWITCHED_OFF_BY`, `services/job.ts`), and enabling either of them is refused
 * while it is on (`jobEnableConflict`), so one switch is on at a time. Overview linking comes after
 * research passes (`.context/overviews.md`, "Switching on"): refused while its own gate or
 * theirs is closed, and while `research_pass` is disabled.
 */
import prisma from '../lib/prisma.js'
import {
  GENERATE_PODCAST_JOB,
  GENERATE_UPLIFTING_PODCAST_JOB,
  PUBLISH_PODCAST_JOB,
  PUBLISH_UPLIFTING_PODCAST_JOB,
  upliftingShowProblem,
} from '../services/podcastEdition.js'
import { podcastConfigProblem } from './podcastBootCheck.js'
import { STORY_CONTEXT_JOB } from '../services/storyContextQueue.js'
import { GENERATE_UPLIFTING_NEWSLETTER_JOB } from './generateNewsletter.js'
import { passSwitchRefusal, REPLACED_JOBS, RESEARCH_PASS_JOB } from '../services/researchPassQueue.js'
import { LINK_OVERVIEWS_JOB, overviewPassConflict, overviewSwitchRefusal } from '../services/overviewQueue.js'
import { PUBLISH_NEWSLETTER_JOB, PUBLISH_UPLIFTING_NEWSLETTER_JOB, newsletterSendProblem, upliftingEditionProblem } from './publishNewsletter.js'
import { config } from '../config.js'

/** Actually Uplifting's podcast jobs run only for an open show with a complete podcast configuration. */
const upliftingPodcastProblem = () => upliftingShowProblem() ?? podcastConfigProblem()

/** Story context reads research's runs and searches the web: without the key neither exists. */
const storyContextProblem = () => (config.research.tavilyApiKey ? null : 'story context needs web search: set TAVILY_API_KEY (.context/story-context.md)')

/** Each check returns why the job cannot run, or null when it can. */
export const ENABLE_CHECKS: Readonly<Record<string, () => string | null>> = {
  [PUBLISH_NEWSLETTER_JOB]: newsletterSendProblem,
  // Actually Uplifting's issue has no audience until the editions are open
  [GENERATE_UPLIFTING_NEWSLETTER_JOB]: upliftingEditionProblem,
  [PUBLISH_UPLIFTING_NEWSLETTER_JOB]: () => upliftingEditionProblem() ?? newsletterSendProblem(),
  [GENERATE_PODCAST_JOB]: podcastConfigProblem,
  [PUBLISH_PODCAST_JOB]: podcastConfigProblem,
  [GENERATE_UPLIFTING_PODCAST_JOB]: upliftingPodcastProblem,
  [PUBLISH_UPLIFTING_PODCAST_JOB]: upliftingPodcastProblem,
  [STORY_CONTEXT_JOB]: storyContextProblem,
  // Until its evals meet their bars, whatever the settings (plan phase 6 opens the gate); then the key and priced models
  [RESEARCH_PASS_JOB]: () => passSwitchRefusal(),
  // Until its own evals meet their bars, and while research passes' gate is closed (overviews switch on after them)
  [LINK_OVERVIEWS_JOB]: () => overviewSwitchRefusal(),
}

/** Why the job may not be enabled now, or null when nothing stands in the way. */
export function jobEnableRefusal(jobName: string): string | null {
  return ENABLE_CHECKS[jobName]?.() ?? null
}

/** The jobs switched off in the same write as enabling the key's job. */
export const SWITCHED_OFF_BY: Readonly<Record<string, readonly string[]>> = {
  [RESEARCH_PASS_JOB]: REPLACED_JOBS,
}

/**
 * Why enabling the job conflicts with another's switch, or null: an old research step while the
 * research pass is enabled, or overview linking while it is not.
 */
export async function jobEnableConflict(jobName: string): Promise<string | null> {
  if (jobName === LINK_OVERVIEWS_JOB) return overviewPassConflict()
  if (!REPLACED_JOBS.includes(jobName)) return null
  const pass = await prisma.jobRun.findUnique({ where: { jobName: RESEARCH_PASS_JOB }, select: { enabled: true } })
  return pass?.enabled ? `${RESEARCH_PASS_JOB} is on and does this step's work: disable it first (.context/research-passes.md)` : null
}

/**
 * Actually Uplifting's short week (`.context/podcast.md`, "Actually Uplifting show"): a week whose
 * pool holds fewer uplifting stories than an episode needs has no episode, and no earlier week's
 * stories fill it. Skipping is the designed behavior, so it is one `info` notice per week, recorded
 * by whichever of the Friday run's last slot or the Saturday publish job sees the short week first;
 * never a warning, a counted attempt or the missed-week alert. The main show has no short week here:
 * too few stories fail its selection, as they always have.
 */
import type { PodcastEdition } from '@prisma/client'
import { config } from '../config.js'
import { notify } from '../lib/notify.js'
import { podcastEditionInfo } from './podcastEdition.js'
import { episodePoolSize } from './podcastScript.js'

/**
 * The stories in the show's pool before `anchor` when they are fewer than an episode needs; null when
 * there are enough, and always for the main show.
 */
export async function shortWeekStoryCount(anchor: Date, edition: PodcastEdition): Promise<number | null> {
  if (edition !== 'uplifting') return null
  const available = await episodePoolSize(anchor, edition)
  return available < config.podcast.minStories ? available : null
}

/** Why the week has no Actually Uplifting episode, as runs and notices word it. */
export function shortWeekReason(available: number): string {
  return `only ${available} published uplifting stories this week; an episode needs ${config.podcast.minStories}`
}

/** The week's one notice that it has no Actually Uplifting episode: insert-only, so a repeat neither reopens nor forwards it. */
export async function recordShortWeek(weekKey: string, available: number): Promise<void> {
  const show = podcastEditionInfo('uplifting').showTitle
  await notify(
    {
      source: 'podcast',
      severity: 'info',
      title: `No ${show} episode this week`,
      message: `${weekKey}: ${shortWeekReason(available)}, counting the stories tagged uplifting that were crawled in the last ${config.content.storyAssignmentDays} days. Nothing needs doing; ${show} skips a week with too few uplifting stories and never fills it with an earlier week's.`,
      link: '/admin/podcasts',
      dedupeKey: `podcast-uplifting-no-stories:${weekKey}`,
    },
    { reopen: false },
  )
}

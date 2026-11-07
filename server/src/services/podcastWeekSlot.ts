/**
 * This ISO week's weekly-episode slot of a show as its Friday automatic run (generate_podcast,
 * generate_uplifting_podcast) sees it: the UTC Friday window the jobs run in, and a read-only view of
 * the week's episode with what the run will do with it. Reading the slot never creates the week's
 * row; "Start this week's episode" (`findOrCreateWeekEpisode`) is what claims it.
 */
import type { PodcastEdition } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { getWeekEpisodeListItem } from './podcast.js'
import { editionRunRefusal, podcastEditionInfo } from './podcastEdition.js'
import { isoWeekKey, weeklyCronAction, type WeeklyCronAction } from './podcastWeekly.js'

const SUNDAY = 0
const FRIDAY = 5
const SATURDAY = 6
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Where `now` falls against this ISO week's Friday window, in UTC whatever the server's zone:
 * `open` on Friday from 00:00 until `generateWindowEndHourUtc` (the job runs only then), `passed`
 * from that hour through Sunday (still the same ISO week), `ahead` from Monday to Thursday.
 */
export type FridayWindow = 'ahead' | 'open' | 'passed'

export function fridayWindow(now: Date): FridayWindow {
  const weekday = now.getUTCDay()
  if (weekday === FRIDAY) return now.getUTCHours() < config.podcast.generateWindowEndHourUtc ? 'open' : 'passed'
  return weekday === SATURDAY || weekday === SUNDAY ? 'passed' : 'ahead'
}

/**
 * The end of this ISO week's Friday window (Friday at `generateWindowEndHourUtc`, UTC): the last
 * moment a Friday run could have read the week's pool. The Saturday publish job reads Actually
 * Uplifting's pool as of then to tell a short week from a missed one.
 */
export function fridayWindowEnd(now: Date): Date {
  const isoWeekday = now.getUTCDay() || 7 // Monday 1 … Sunday 7: the ISO week runs Monday to Sunday
  const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return new Date(day + (FRIDAY - isoWeekday) * DAY_MS + config.podcast.generateWindowEndHourUtc * 60 * 60 * 1000)
}

/**
 * The window as the slot notice reports it: `fridayWindow(now)`, except that Friday counts as
 * `passed` once the hour after the last generation slot (`reminderFromHourUtc`) begins. The gate
 * stays open until `generateWindowEndHourUtc`, but no slot fires between those hours, so the notice
 * must not promise that Friday's run will still create or finish the episode. Display only; the
 * cron gate keeps `fridayWindow`.
 */
export function slotWindow(now: Date): FridayWindow {
  const window = fridayWindow(now)
  return window === 'open' && now.getUTCHours() > config.podcast.reminderFromHourUtc ? 'passed' : window
}

/**
 * The show's slot this week: its episode or null, what Friday's run will do (`create` when free), the
 * window, whether the show's generate job is on, and why a person cannot start the week's episode
 * (`showProblem`, the closed show's reason; null when they can).
 */
export async function getWeekSlot(now: Date, edition: PodcastEdition) {
  const weekKey = isoWeekKey(now)
  const [episode, job] = await Promise.all([
    getWeekEpisodeListItem(weekKey, edition),
    prisma.jobRun.findUnique({ where: { jobName: podcastEditionInfo(edition).generateJob }, select: { enabled: true } }),
  ])
  const fridayRun: 'create' | WeeklyCronAction = episode ? weeklyCronAction(episode) : 'create'
  return {
    edition,
    weekKey,
    episode,
    fridayRun,
    fridayWindow: slotWindow(now),
    automaticRunEnabled: job?.enabled === true,
    showProblem: editionRunRefusal(edition, config.podcast.dryRun),
  }
}

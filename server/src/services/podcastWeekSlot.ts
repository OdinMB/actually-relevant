/**
 * This ISO week's weekly-episode slot as the Friday automatic run (generate_podcast) sees it: the
 * UTC Friday window the job runs in, and a read-only view of the week's episode with what the run
 * will do with it. Reading the slot never creates the week's row; "Start this week's episode"
 * (`findOrCreateWeekEpisode`) is what claims it.
 */
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { getWeekEpisodeListItem } from './podcast.js'
import { isoWeekKey, weeklyCronAction, type WeeklyCronAction } from './podcastWeekly.js'

const SUNDAY = 0
const FRIDAY = 5
const SATURDAY = 6
const GENERATE_JOB = 'generate_podcast'

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

/** This week's slot: its episode or null, what Friday's run will do (`create` when free), the window, and whether the job is on. */
export async function getWeekSlot(now: Date = new Date()) {
  const weekKey = isoWeekKey(now)
  const [episode, job] = await Promise.all([
    getWeekEpisodeListItem(weekKey),
    prisma.jobRun.findUnique({ where: { jobName: GENERATE_JOB }, select: { enabled: true } }),
  ])
  const fridayRun: 'create' | WeeklyCronAction = episode ? weeklyCronAction(episode) : 'create'
  return { weekKey, episode, fridayRun, fridayWindow: fridayWindow(now), automaticRunEnabled: job?.enabled === true }
}

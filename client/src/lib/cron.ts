/**
 * Cron expression helpers for the admin UI.
 * Converts between cron expressions and human-readable descriptions,
 * and provides preset schedules for the cron editor.
 */

export interface CronPreset {
  label: string
  value: string
}

export const CRON_PRESETS: CronPreset[] = [
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Every 2 hours', value: '0 */2 * * *' },
  { label: 'Every 4 hours', value: '0 */4 * * *' },
  { label: 'Every 6 hours', value: '0 */6 * * *' },
  { label: 'Every 12 hours', value: '0 */12 * * *' },
  { label: 'Daily at midnight', value: '0 0 * * *' },
  { label: 'Daily at 6:00 AM', value: '0 6 * * *' },
  { label: 'Daily at 9:00 AM', value: '0 9 * * *' },
  { label: 'Daily at noon', value: '0 12 * * *' },
  { label: 'Daily at 6:00 PM', value: '0 18 * * *' },
  { label: 'Weekdays at 9:00 AM', value: '0 9 * * 1-5' },
  { label: 'Mon/Wed/Fri at 9:00 AM', value: '0 9 * * 1,3,5' },
  { label: 'Tue/Thu at 9:00 AM', value: '0 9 * * 2,4' },
]

// Reading a field as the scheduler does

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const WEEKDAY_SHORT = WEEKDAYS.map(d => d.slice(0, 3))

interface FieldRule {
  /** What `*` stands for. */
  all: [number, number]
  /** The values the scheduler accepts once the field is expanded. */
  valid: [number, number]
}

const SECOND: FieldRule = { all: [0, 59], valid: [0, 59] }
const MINUTE: FieldRule = { all: [0, 59], valid: [0, 59] }
const HOUR: FieldRule = { all: [0, 23], valid: [0, 23] }
const DAY: FieldRule = { all: [1, 31], valid: [1, 31] }
const MONTH: FieldRule = { all: [1, 12], valid: [1, 12] }
const WEEKDAY: FieldRule = { all: [0, 6], valid: [0, 7] }

const replaceNames = (field: string, names: string[], first: number) =>
  names.reduce((f, name, i) => f.replace(new RegExp(name, 'gi'), String(i + first)), field)

const span = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)

/**
 * The values a field runs on, read as node-cron 3 (the server's scheduler) reads it, or null for a
 * field it refuses. Names become numbers (month names, weekday names, and a weekday 7 as Sunday), `*`
 * the whole span, `a-b` the values between (a reversed range is swapped: `22-6` is 6 to 22), and a
 * step `/n` keeps the values divisible by n (`5-55/10` is 10, 20, ... 50).
 */
function expandField(field: string, rule: FieldRule, kind?: 'month' | 'weekday'): number[] | null {
  let f = field
  if (kind === 'month')
    f = replaceNames(
      replaceNames(f, MONTHS, 1),
      MONTHS.map(m => m.slice(0, 3)),
      1,
    )
  if (kind === 'weekday') f = replaceNames(replaceNames(f.replace('7', '0'), WEEKDAYS, 0), WEEKDAY_SHORT, 0)
  f = f.replace('*', `${rule.all[0]}-${rule.all[1]}`)
  f = f.replace(/(\d+)-(\d+)/g, (_, a: string, b: string) => {
    const [lo, hi] = [Number(a), Number(b)].sort((x, y) => x - y) as [number, number]
    return span(lo, hi).join(',')
  })
  const step = /^(.+)\/(\w+)$/.exec(f)
  if (step) {
    const n = Number(step[2])
    if (!Number.isInteger(n) || n <= 0) return null
    f = step[1]!
      .split(',')
      .filter(v => Number(v) % n === 0)
      .join(',')
  }
  const options = f.split(',')
  if (!options.every(o => /^\d+$/.test(o) && Number(o) >= rule.valid[0] && Number(o) <= rule.valid[1])) return null
  return [...new Set(options.map(Number))].sort((a, b) => a - b)
}

// Describing the values

/** How a field's values read: every value, every nth from 0, one unbroken range, or a list. */
type Shape = { kind: 'all' } | { kind: 'step'; n: number } | { kind: 'range'; from: number; to: number } | { kind: 'list'; values: number[] }

function shapeOf(field: string, values: number[], [lo, hi]: [number, number]): Shape {
  // A list written out reads as written, even where it happens to form a step or a range
  if (/^[\d,]+$/.test(field)) return { kind: 'list', values }
  if (values.length === hi - lo + 1) return { kind: 'all' }
  const n = values[1]! - values[0]!
  const multiples = span(lo, hi).filter(v => v % n === 0)
  if (values.length > 1 && values[0] === 0 && multiples.length === values.length && multiples.every((v, i) => v === values[i])) return { kind: 'step', n }
  const last = values[values.length - 1]!
  if (values.length > 1 && last - values[0]! === values.length - 1) return { kind: 'range', from: values[0]!, to: last }
  return { kind: 'list', values }
}

const pad = (n: number) => n.toString().padStart(2, '0')
const minuteMark = (m: number) => `:${pad(m)}`

function formatHourLabel(hour: number): string {
  if (hour === 0) return '12 AM'
  if (hour === 12) return '12 PM'
  if (hour < 12) return `${hour} AM`
  return `${hour - 12} PM`
}

function formatTime(hour: number, minute: number, second = 0): string {
  const clock = `${hour % 12 === 0 ? 12 : hour % 12}:${pad(minute)}${second ? `:${pad(second)}` : ''}`
  return `${clock} ${hour < 12 ? 'AM' : 'PM'}`
}

/** Values as a list, runs of three or more as `first-last` (with an en dash). */
function compress(values: number[], name: (v: number) => string): string {
  const runs: [number, number][] = []
  for (const v of values) {
    const last = runs[runs.length - 1]
    if (last && v === last[1] + 1) last[1] = v
    else runs.push([v, v])
  }
  return runs.flatMap(([a, b]) => (b - a >= 2 ? [`${name(a)}\u2013${name(b)}`] : span(a, b).map(name))).join(', ')
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`

/** "every minute", "every 15 minutes", "every minute from :00 to :10"; null for a list of minutes. */
function minutesPhrase(shape: Shape): string | null {
  if (shape.kind === 'all') return 'every minute'
  if (shape.kind === 'step') return `every ${plural(shape.n, 'minute')}`
  if (shape.kind === 'range') return `every minute from ${minuteMark(shape.from)} to ${minuteMark(shape.to)}`
  return null
}

const hourRange = (from: number, to: number) => `${formatHourLabel(from)} \u2013 ${formatHourLabel(to)}`
const inHours = (hours: number[]) => `in the ${hours.map(formatHourLabel).join(', ')} hour${hours.length === 1 ? '' : 's'}`

/** The time of day: clock times when there are few enough, else what runs within which hours. */
function timeOfDay(minute: Shape, hour: Shape, second: number): { clock: string } | { phrase: string } {
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  if (minute.kind === 'list') {
    const mins = minute.values.map(minuteMark).join(', ')
    const onTheHour = minute.values.length === 1 && minute.values[0] === 0
    if (hour.kind === 'list' && minute.values.length * hour.values.length <= 12) {
      return { clock: hour.values.flatMap(h => minute.values.map(m => formatTime(h, m, second))).join(', ') }
    }
    if (hour.kind === 'all') return { phrase: onTheHour ? 'Every hour' : `Hourly at ${mins}` }
    if (hour.kind === 'step') return { phrase: `Every ${plural(hour.n, 'hour')}${onTheHour ? '' : ` at ${mins}`}` }
    if (hour.kind === 'range') return { phrase: `${onTheHour ? 'Every hour' : `Hourly at ${mins}`}, ${hourRange(hour.from, hour.to)}` }
    return { phrase: `Hourly at ${mins} ${inHours(hour.values)}` }
  }
  const every = cap(minutesPhrase(minute)!)
  if (hour.kind === 'all') return { phrase: every }
  if (hour.kind === 'step') return { phrase: `${every}, every ${plural(hour.n, 'hour')}` }
  if (hour.kind === 'range') return { phrase: `${every}, ${hourRange(hour.from, hour.to)}` }
  return { phrase: `${every} ${inHours(hour.values)}` }
}

/** The weekdays a schedule needs, or null for every day. */
function weekdaysPhrase(days: number[]): string | null {
  if (days.length === 7) return null
  if (days.join() === '1,2,3,4,5') return 'weekdays'
  if (days.join() === '0,6') return 'weekends'
  return compress(days, d => WEEKDAY_SHORT[d]!)
}

/**
 * Convert a cron expression to a human-readable string: every expression the scheduler accepts
 * (node-cron 3: five fields, or six with seconds first; numbers, names, `*`, ranges, steps and
 * lists), read as it runs them, and the raw expression for one it would refuse.
 */
export function cronToHuman(expr: string): string {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5 && parts.length !== 6) return expr
  const [secondField, minuteField, hourField, dayField, monthField, weekdayField] = (parts.length === 5 ? ['0', ...parts] : parts) as [
    string,
    string,
    string,
    string,
    string,
    string,
  ]

  const seconds = expandField(secondField, SECOND)
  const minutes = expandField(minuteField, MINUTE)
  const hours = expandField(hourField, HOUR)
  const days = expandField(dayField, DAY)
  const months = expandField(monthField, MONTH, 'month')
  const weekdays = expandField(weekdayField, WEEKDAY, 'weekday')
  if (!seconds || !minutes || !hours || !days || !months || !weekdays) return expr

  const minute = shapeOf(minuteField, minutes, MINUTE.all)
  const hour = shapeOf(hourField, hours, HOUR.all)
  const second = shapeOf(secondField, seconds, SECOND.all)
  // One second past the minute shows in the clock times; several, as their own phrase first
  const oneSecond = second.kind === 'list' && second.values.length === 1 && minute.kind === 'list' && hour.kind === 'list' ? second.values[0]! : 0
  const time = timeOfDay(minute, hour, oneSecond)
  const weekday = weekdaysPhrase(weekdays)
  const day = days.length === 31 ? null : `on day${days.length === 1 ? '' : 's'} ${compress(days, String)} of the month`
  const month = months.length === 12 ? null : `in ${compress(months, m => MONTHS[m - 1]!)}`

  let text: string
  if (!day && !month) {
    if ('clock' in time) text = weekday ? `${weekday} at ${time.clock}` : `Daily at ${time.clock}`
    else text = weekday ? `${weekday}, ${time.phrase.charAt(0).toLowerCase()}${time.phrase.slice(1)}` : time.phrase
  } else {
    const base = 'clock' in time ? `${day ? 'At' : 'Daily at'} ${time.clock}` : time.phrase
    text = [base, day, month].filter(Boolean).join(' ') + (weekday ? `, ${weekday} only` : '')
  }

  // On the minute, or one second already in the clock times: nothing more to say
  if (oneSecond || (seconds.length === 1 && seconds[0] === 0)) return text
  // "Every 30 seconds" says it all; a list of seconds still needs "every minute" after it
  const everyMinute = minute.kind === 'all' && hour.kind === 'all' && !day && !month && !weekday && second.kind !== 'list'
  return everyMinute ? secondsPhrase(second) : `${secondsPhrase(second)}, ${text.charAt(0).toLowerCase()}${text.slice(1)}`
}

/** "Every second", "Every 30 seconds", "Every second from :00 to :10", "At seconds 0, 30". */
function secondsPhrase(second: Shape): string {
  if (second.kind === 'all') return 'Every second'
  if (second.kind === 'step') return `Every ${plural(second.n, 'second')}`
  if (second.kind === 'range') return `Every second from ${minuteMark(second.from)} to ${minuteMark(second.to)}`
  return `At second${second.values.length === 1 ? '' : 's'} ${second.values.join(', ')}`
}

/**
 * Check if a cron expression matches one of the presets.
 */
export function findPreset(expr: string): CronPreset | undefined {
  return CRON_PRESETS.find(p => p.value === expr.trim())
}

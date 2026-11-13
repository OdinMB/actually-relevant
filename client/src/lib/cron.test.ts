import { describe, it, expect } from 'vitest'
import { cronToHuman, findPreset } from './cron'

describe('cronToHuman', () => {
  it('converts every N hours patterns', () => {
    expect(cronToHuman('0 */2 * * *')).toBe('Every 2 hours')
    expect(cronToHuman('0 */4 * * *')).toBe('Every 4 hours')
    expect(cronToHuman('0 */6 * * *')).toBe('Every 6 hours')
    expect(cronToHuman('0 */12 * * *')).toBe('Every 12 hours')
  })

  it('converts every hour', () => {
    expect(cronToHuman('0 * * * *')).toBe('Every hour')
  })

  it('converts daily at specific hour', () => {
    expect(cronToHuman('0 0 * * *')).toBe('Daily at 12:00 AM')
    expect(cronToHuman('0 6 * * *')).toBe('Daily at 6:00 AM')
    expect(cronToHuman('0 9 * * *')).toBe('Daily at 9:00 AM')
    expect(cronToHuman('0 12 * * *')).toBe('Daily at 12:00 PM')
    expect(cronToHuman('0 18 * * *')).toBe('Daily at 6:00 PM')
  })

  it('converts multiple specific hours', () => {
    expect(cronToHuman('0 9,21 * * *')).toBe('Daily at 9:00 AM, 9:00 PM')
    expect(cronToHuman('0 1,7,13,19 * * *')).toBe('Daily at 1:00 AM, 7:00 AM, 1:00 PM, 7:00 PM')
  })

  it('converts weekday patterns', () => {
    expect(cronToHuman('0 9 * * 1-5')).toBe('weekdays at 9:00 AM')
    expect(cronToHuman('0 9 * * 1,3,5')).toBe('Mon, Wed, Fri at 9:00 AM')
    expect(cronToHuman('0 9 * * 2,4')).toBe('Tue, Thu at 9:00 AM')
  })

  it('converts day patterns with every N hours', () => {
    expect(cronToHuman('0 */6 * * 1-5')).toBe('weekdays, every 6 hours')
    expect(cronToHuman('0 */4 * * 1,3,5')).toBe('Mon, Wed, Fri, every 4 hours')
  })

  it('converts every N minutes patterns', () => {
    expect(cronToHuman('*/5 * * * *')).toBe('Every 5 minutes')
    expect(cronToHuman('*/15 * * * *')).toBe('Every 15 minutes')
    expect(cronToHuman('*/30 * * * *')).toBe('Every 30 minutes')
  })

  it('converts non-zero minutes with specific hours', () => {
    expect(cronToHuman('30 9 * * *')).toBe('Daily at 9:30 AM')
    expect(cronToHuman('15 18 * * *')).toBe('Daily at 6:15 PM')
    expect(cronToHuman('45 0 * * *')).toBe('Daily at 12:45 AM')
    expect(cronToHuman('30 12 * * *')).toBe('Daily at 12:30 PM')
  })

  it('converts non-zero minutes with multiple hours', () => {
    expect(cronToHuman('30 9,21 * * *')).toBe('Daily at 9:30 AM, 9:30 PM')
    expect(cronToHuman('15 6,18 * * *')).toBe('Daily at 6:15 AM, 6:15 PM')
  })

  it('converts non-zero minutes with day patterns', () => {
    expect(cronToHuman('30 9 * * 1-5')).toBe('weekdays at 9:30 AM')
    expect(cronToHuman('15 9 * * 1,3,5')).toBe('Mon, Wed, Fri at 9:15 AM')
  })

  it('converts non-zero minutes with every N hours', () => {
    expect(cronToHuman('15 */6 * * *')).toBe('Every 6 hours at :15')
    expect(cronToHuman('30 */4 * * *')).toBe('Every 4 hours at :30')
  })

  it('converts hour range patterns', () => {
    expect(cronToHuman('0 9-17 * * *')).toBe('Every hour, 9 AM \u2013 5 PM')
    expect(cronToHuman('0 8-20 * * *')).toBe('Every hour, 8 AM \u2013 8 PM')
  })

  it('reads a reversed range as the scheduler does: node-cron runs 22-6 from 6 to 22', () => {
    expect(cronToHuman('0 22-6 * * *')).toBe('Every hour, 6 AM \u2013 10 PM')
  })

  it('converts every N minutes with restricted hours', () => {
    expect(cronToHuman('*/15 9-17 * * *')).toBe('Every 15 minutes, 9 AM \u2013 5 PM')
    expect(cronToHuman('*/5 8-20 * * *')).toBe('Every 5 minutes, 8 AM \u2013 8 PM')
  })

  it('converts every N minutes with day patterns', () => {
    expect(cronToHuman('*/10 * * * 1-5')).toBe('weekdays, every 10 minutes')
  })

  it('converts hourly at a minute past the hour', () => {
    expect(cronToHuman('15 * * * *')).toBe('Hourly at :15')
    expect(cronToHuman('5 * * * *')).toBe('Hourly at :05')
    expect(cronToHuman('20 * * * 1-5')).toBe('weekdays, hourly at :20')
    expect(cronToHuman('0,30 * * * *')).toBe('Hourly at :00, :30')
    expect(cronToHuman('15 9-17 * * *')).toBe('Hourly at :15, 9 AM \u2013 5 PM')
  })

  it('converts every minute, and minute ranges', () => {
    expect(cronToHuman('* * * * *')).toBe('Every minute')
    expect(cronToHuman('0-10 * * * *')).toBe('Every minute from :00 to :10')
    expect(cronToHuman('* 9 * * *')).toBe('Every minute in the 9 AM hour')
  })

  it('converts every N minutes or hours within single hours or other steps', () => {
    expect(cronToHuman('*/15 9 * * *')).toBe('Every 15 minutes in the 9 AM hour')
    expect(cronToHuman('*/30 9,21 * * *')).toBe('Every 30 minutes in the 9 AM, 9 PM hours')
    expect(cronToHuman('*/15 */2 * * *')).toBe('Every 15 minutes, every 2 hours')
  })

  it('reads a stepped range as node-cron does, keeping the values divisible by the step', () => {
    expect(cronToHuman('5-55/10 * * * *')).toBe('Hourly at :10, :20, :30, :40, :50')
    expect(cronToHuman('0 8-18/2 * * *')).toBe('Daily at 8:00 AM, 10:00 AM, 12:00 PM, 2:00 PM, 4:00 PM, 6:00 PM')
  })

  it('converts the research pipeline schedule', () => {
    expect(cronToHuman('5 2 * * *')).toBe('Daily at 2:05 AM')
    expect(cronToHuman('7 2 * * *')).toBe('Daily at 2:07 AM')
    expect(cronToHuman('45 2 * * *')).toBe('Daily at 2:45 AM')
  })

  it('converts days of the month and months', () => {
    expect(cronToHuman('0 9 15 * *')).toBe('At 9:00 AM on day 15 of the month')
    expect(cronToHuman('0 3 1,15 * *')).toBe('At 3:00 AM on days 1, 15 of the month')
    expect(cronToHuman('0 3 1-7 * *')).toBe('At 3:00 AM on days 1\u20137 of the month')
    expect(cronToHuman('0 9 * 3 *')).toBe('Daily at 9:00 AM in March')
    expect(cronToHuman('0 0 1 1 *')).toBe('At 12:00 AM on day 1 of the month in January')
    expect(cronToHuman('0 9 1 jan,jul *')).toBe('At 9:00 AM on day 1 of the month in January, July')
    expect(cronToHuman('*/15 * 1 * *')).toBe('Every 15 minutes on day 1 of the month')
    // node-cron needs both: day 1-7 and a Monday, the first Monday of the month
    expect(cronToHuman('0 9 1-7 * 1')).toBe('At 9:00 AM on days 1\u20137 of the month, Mon only')
  })

  it('converts weekday names and Sunday as 7', () => {
    expect(cronToHuman('0 9 * * mon,wed')).toBe('Mon, Wed at 9:00 AM')
    expect(cronToHuman('0 9 * * Saturday,Sunday')).toBe('weekends at 9:00 AM')
    expect(cronToHuman('0 9 * * 7')).toBe('Sun at 9:00 AM')
    expect(cronToHuman('0 9 * * 1-3')).toBe('Mon\u2013Wed at 9:00 AM')
  })

  it('converts six-field expressions with seconds', () => {
    expect(cronToHuman('0 0 9 * * *')).toBe('Daily at 9:00 AM')
    expect(cronToHuman('*/30 * * * * *')).toBe('Every 30 seconds')
    expect(cronToHuman('30 0 9 * * *')).toBe('Daily at 9:00:30 AM')
    expect(cronToHuman('0,30 * * * * *')).toBe('At seconds 0, 30, every minute')
  })

  it('returns the raw expression for one the scheduler would refuse', () => {
    expect(cronToHuman('invalid')).toBe('invalid')
    expect(cronToHuman('60 * * * *')).toBe('60 * * * *')
    expect(cronToHuman('0 24 * * *')).toBe('0 24 * * *')
    expect(cronToHuman('0 9 * * 8')).toBe('0 9 * * 8')
    expect(cronToHuman('0 9 0 * *')).toBe('0 9 0 * *')
    expect(cronToHuman('*/x * * * *')).toBe('*/x * * * *')
    expect(cronToHuman('0 9 * *')).toBe('0 9 * *')
  })
})

describe('findPreset', () => {
  it('finds matching presets', () => {
    expect(findPreset('0 */6 * * *')?.label).toBe('Every 6 hours')
    expect(findPreset('0 9 * * 1-5')?.label).toBe('Weekdays at 9:00 AM')
    expect(findPreset('0 9 * * 1,3,5')?.label).toBe('Mon/Wed/Fri at 9:00 AM')
  })

  it('returns undefined for non-preset expressions', () => {
    expect(findPreset('0 9,21 * * *')).toBeUndefined()
    expect(findPreset('*/5 * * * *')).toBeUndefined()
  })
})

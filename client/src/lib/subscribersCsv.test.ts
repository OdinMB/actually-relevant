import { describe, it, expect } from 'vitest'
import { subscribersToCsv } from './subscribersCsv'
import type { SubscriberRow } from './admin-api'

const row = (overrides: Partial<SubscriberRow>): SubscriberRow => ({
  email: 'a@x.com',
  dbStatus: null,
  dbConfirmedAt: null,
  dbCreatedAt: null,
  plunkStatus: null,
  plunkContactId: null,
  mismatch: false,
  ...overrides,
})

describe('subscribersToCsv', () => {
  it('writes a header and one line per row, with blanks for nulls', () => {
    const csv = subscribersToCsv([
      row({ email: 'a@x.com', dbStatus: 'confirmed', dbConfirmedAt: '2026-02-01', dbCreatedAt: '2026-01-01', plunkStatus: 'subscribed', plunkContactId: 'p1' }),
      row({ email: 'b@x.com', plunkStatus: 'unsubscribed' }),
    ])
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('email,in_db,db_confirmed_at,db_created_at,in_plunk,plunk_contact_id')
    expect(lines[1]).toBe('a@x.com,confirmed,2026-02-01,2026-01-01,subscribed,p1')
    expect(lines[2]).toBe('b@x.com,,,,unsubscribed,')
  })

  it('escapes values containing commas or quotes', () => {
    const csv = subscribersToCsv([row({ email: 'weird,"name"@x.com' })])
    expect(csv.split('\r\n')[1]).toBe('"weird,""name""@x.com",,,,,')
  })

  it('neutralizes spreadsheet formula injection by prefixing a quote', () => {
    const csv = subscribersToCsv([row({ email: '=cmd@x.com' })])
    expect(csv.split('\r\n')[1]).toBe("'=cmd@x.com,,,,,")
  })
})

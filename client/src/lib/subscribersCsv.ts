import type { SubscriberRow } from './admin-api'

const HEADERS = ['email', 'in_db', 'db_confirmed_at', 'db_created_at', 'in_plunk', 'plunk_contact_id'] as const

/**
 * Neutralize spreadsheet formula injection: a field that starts with =, +, -, @,
 * or a leading control char is prefixed with a quote so Excel/Sheets treat it as
 * text rather than executing it as a formula.
 */
function sanitizeField(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
}

/** Sanitize, then quote a field when it contains a comma, quote, or newline (RFC 4180). */
function escapeCsv(value: string): string {
  const safe = sanitizeField(value)
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** Serialize reconciliation rows into CSV text — one line per subscriber, blanks for nulls. */
export function subscribersToCsv(rows: SubscriberRow[]): string {
  const lines = [HEADERS.join(',')]
  for (const r of rows) {
    lines.push(
      [r.email, r.dbStatus ?? '', r.dbConfirmedAt ?? '', r.dbCreatedAt ?? '', r.plunkStatus ?? '', r.plunkContactId ?? '']
        .map((v) => escapeCsv(String(v)))
        .join(','),
    )
  }
  // CRLF record terminator per RFC 4180 (Excel opens it correctly on Windows).
  return lines.join('\r\n')
}

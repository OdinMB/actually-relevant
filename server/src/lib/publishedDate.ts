/**
 * A source's publish date, as feeds and extractors write it, read into an ISO string or null. Pure.
 *
 * JavaScript's Date reads RFC 822 dates but knows only the US zone names (EST, PDT, …), so a date
 * such as SIPRI's "19 Nov 2026 10:07:08 CET" is an Invalid Date. The zone names below are swapped
 * for their offsets first. A date that still does not read is null: the story keeps its crawl date
 * instead of failing to save.
 */

/** Unambiguous zone names a feed may end a date with, and their UTC offsets. IST and the like are left out. */
const ZONE_OFFSETS: Record<string, string> = {
  WET: '+0000',
  WEST: '+0100',
  BST: '+0100',
  CET: '+0100',
  CEST: '+0200',
  MET: '+0100',
  MEST: '+0200',
  EET: '+0200',
  EEST: '+0300',
  MSK: '+0300',
  WAT: '+0100',
  CAT: '+0200',
  SAST: '+0200',
  EAT: '+0300',
  HKT: '+0800',
  SGT: '+0800',
  JST: '+0900',
  KST: '+0900',
  AWST: '+0800',
  ACST: '+0930',
  ACDT: '+1030',
  AEST: '+1000',
  AEDT: '+1100',
  NZST: '+1200',
  NZDT: '+1300',
}

const TRAILING_ZONE = /\s([A-Za-z]{3,4})$/

const isoOrNull = (text: string): string | null => {
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function parsePublishedDate(raw: string | null | undefined): string | null {
  const text = raw?.trim()
  if (!text) return null
  const direct = isoOrNull(text)
  if (direct) return direct
  const zone = TRAILING_ZONE.exec(text)?.[1]?.toUpperCase()
  const offset = zone ? ZONE_OFFSETS[zone] : undefined
  if (!offset) return null
  return isoOrNull(text.replace(TRAILING_ZONE, ` ${offset}`))
}

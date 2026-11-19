export const ISSUE_LINKS = [
  {
    label: 'Human Development',
    slug: 'human-development',
    href: '/issues/human-development',
  },
  {
    label: 'Planet & Climate',
    slug: 'planet-climate',
    href: '/issues/planet-climate',
  },
  {
    label: 'Existential Threats',
    slug: 'existential-threats',
    href: '/issues/existential-threats',
  },
  {
    label: 'Science & Technology',
    slug: 'science-technology',
    href: '/issues/science-technology',
  },
]

export const FOOTER_NAV = [
  { label: 'About', href: '/about' },
  { label: 'Methodology', href: '/methodology' },
  { label: 'Topics', href: '/issues' },
  { label: 'How We Compare', href: '/compare' },
  { label: 'News Fatigue', href: '/news-fatigue' },
  { label: 'Thank You', href: '/thank-you' },
]

/** The footer's Navigate column: with "Ongoing Stories" after Topics while the ongoing stories are switched on. */
export function footerNav(ongoing: boolean): { label: string; href: string }[] {
  if (!ongoing) return FOOTER_NAV
  const at = FOOTER_NAV.findIndex(link => link.href === '/issues') + 1
  return [...FOOTER_NAV.slice(0, at), { label: 'Ongoing Stories', href: '/ongoing' }, ...FOOTER_NAV.slice(at)]
}

export const FOOTER_LEGAL = [
  { label: 'Legal notice / Impressum', href: '/imprint' },
  { label: 'Privacy', href: '/privacy' },
  { label: 'No tracking', href: '/no-ads-no-tracking' },
]

/** True on an issue page and on any page below it. */
export function isActiveIssue(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + '/')
}

/**
 * The `recenter` step's planted cases (`.context/model-eval.md`, "Overview evals"; plan
 * `.plans/2026-11-19_overview-recentering.md`, "Evals"): eval code, never a key edit. For each judged
 * development a hand-written narrowed charter, a plausible early center too narrow for what the
 * development became, with the must entries it would have held; the case is built at the development's
 * two-thirds checkpoint, and a re-center back to the key's charter is the expected outcome. One
 * anchor breach: Colorado's members offered only the near misses a "Western US water loss" charter
 * would take in, which leaves the rules fight behind, so no re-center is the expected outcome. And one
 * neighbor a wider charter would absorb: Lebanon offered the regional war's stories beside the open
 * Strait of Hormuz overview, so no re-center is the expected outcome. The base OUT list is the key's,
 * which every re-center keeps. Pure data.
 */

/** A development's planted narrowed charter: its title, IN and end event, and the must entries it holds (the first two its founding). */
export interface NarrowedPlant {
  key: string
  title: string
  in: string
  endEvent: string | null
  /** Must entries of the key, by slug; the first two are the founding entries. */
  members: string[]
}

export const NARROWED_PLANTS: readonly NarrowedPlant[] = [
  {
    key: 'ebola-drc-2026',
    title: "WHO's Ebola emergency in eastern DR Congo",
    in: "The World Health Organization's handling of the Bundibugyo Ebola outbreak in eastern DR Congo since its emergency declaration of 17 May 2026: WHO's declarations, risk assessments, warnings and estimates of the outbreak's size.",
    endEvent: 'WHO ends the public health emergency of international concern it declared for the outbreak.',
    members: [
      'who-declares-international-emergency-after-deaths-in-drc-and-uganda',
      'who-raises-national-risk-to-very-high-in-eastern-drc',
      'who-warns-of-ebola-and-conflict-colliding-in-eastern-congo',
      'who-says-unchecked-ebola-circulates-in-northeastern-drc',
      'who-drc-cases-may-be-two-to-four-times-higher',
    ],
  },
  {
    key: 'el-nino-2026',
    title: "El Niño's threat to the Indian monsoon",
    in: "Forecasts that a developing El Niño in the tropical Pacific will weaken South Asia's 2026 summer monsoon: the odds of a deficient Indian monsoon, and the heat and drought risk for India and its neighbors.",
    endEvent: "India's meteorological department declares the 2026 southwest monsoon season over.",
    members: [
      'us-forecast-raises-chance-of-deficient-indian-monsoon-this-summer',
      'el-nino-forecast-raises-heat-drought-risk-in-south-asia',
      'pacific-warming-set-to-weaken-india-s-monsoon',
    ],
  },
  {
    key: 'lebanon-war-2026',
    title: 'Israeli strikes on Beirut',
    in: "Israel's air strikes on Beirut and its southern suburbs since March 2026 and the evacuation orders that came with them: the strikes, their toll and the people they drove from the capital.",
    endEvent: 'Israel stops striking Beirut.',
    members: [
      'israel-orders-400-000-from-southern-beirut-amid-threats',
      'israel-hits-central-beirut-killing-hundreds-and-uprooting-800-000',
      'israel-strikes-beirut-after-hezbollah-rocket-barrage',
    ],
  },
  {
    key: 'pandemic-agreement-pabs',
    title: 'The May 2026 deadline for the WHO pathogen-sharing annex',
    in: "WHO member states' push to finish the Pathogen Access and Benefit-Sharing (PABS) annex to the Pandemic Agreement in time for its adoption at the World Health Assembly in May 2026.",
    endEvent: 'The May 2026 World Health Assembly adopts the PABS annex or closes without it.',
    members: ['pandemic-preparedness-rules-who-states-advance-talks-on-pathogen-access-and', 'countries-miss-deadline-blocking-who-deal-on-vaccines-and-tests'],
  },
  {
    key: 'colorado-river-rules',
    title: "The seven states' Colorado River talks",
    in: "The seven Colorado River basin states' negotiations, and the lawsuits they threaten, over how to share the river's water once the current rules expire in 2026.",
    endEvent: 'The seven basin states sign a consensus deal on sharing the river.',
    members: ['seven-states-face-water-cuts-and-lawsuits', 'trump-must-decide-on-water-cuts-for-40-million'],
  },
]

/**
 * The anchor breach (D-RC14): Colorado with its must entries as members, offered only near misses that
 * a "Western US water loss" charter would take in. The plan placed it at the two-thirds checkpoint, but
 * two of these stories come after it (and after the end checkpoint), so the case is built on the day
 * of the newest of them, with every must entry published by then. Each offered story carries the
 * signal quote the link call would plausibly give: words of its title (used only where the story's
 * own text holds them; otherwise its whole title, as for every other offered story).
 */
export const ANCHOR_BREACH = {
  key: 'colorado-river-rules',
  offered: [
    'fossil-firms-tied-to-half-of-western-water-losses',
    'sacramento-valley-sinks-50-cm-yearly-cutting-farm-water',
    'droughts-cut-rivers-threaten-power-and-food',
    'drought-and-staff-shortages-heighten-western-risk',
  ],
  quotes: {
    'fossil-firms-tied-to-half-of-western-water-losses': 'half of Western water losses',
    'sacramento-valley-sinks-50-cm-yearly-cutting-farm-water': 'cutting farm water',
    'droughts-cut-rivers-threaten-power-and-food': 'Droughts cut rivers',
    'drought-and-staff-shortages-heighten-western-risk': 'heighten western risk',
  },
} as const

/**
 * The neighbor a wider charter would absorb (D-RC2: merging is not a re-center's, so the check is shown
 * the open overviews near the stories and refuses an IN that takes one in). Lebanon under an earlier
 * charter, the key's without the OUT entries that already shut out the regional war, the strait and
 * the US-Iran talks, with its must entries as members; offered its near misses of the wider
 * US/Israel-Iran war (none an entry of the Hormuz key, so none would be active there); with the Strait
 * of Hormuz overview open beside it (that key's title and IN; the key is the tune half's, read only
 * for this). Taking the stories in needs a charter of the whole regional war, which takes in the
 * Hormuz overview: no re-center is the expected outcome, kept or refused by the neighbor rule. Built
 * on the day of the newest offered story.
 */
export const NEIGHBOUR_ABSORB = {
  key: 'lebanon-war-2026',
  neighbour: 'hormuz-shipping-2026',
  /** The key's OUT entries this earlier charter does not have yet. */
  notYetOut: [
    'The wider US/Israel-Iran war: strikes in Iran, Iranian missile fire on Israel and the Gulf states',
    'Strait of Hormuz closure, shipping and Gulf energy',
    'US-Iran talks, ceasefires and the June 2026 memorandum, except where they set terms for the Lebanon front',
  ],
  offered: [
    'israel-and-us-strike-iran-as-region-teeters-toward-war',
    'trump-says-iran-campaign-very-soon-as-oil-tops-100',
    'millions-flee-as-regional-war-widens',
    'israel-warns-of-thousands-more-targets-in-iran',
    'iran-strikes-tel-aviv-with-cluster-missiles',
    'mediators-pursue-ceasefire-while-iran-nuclear-dispute-persists',
  ],
  quotes: {
    'israel-and-us-strike-iran-as-region-teeters-toward-war': 'region teeters toward war',
    'trump-says-iran-campaign-very-soon-as-oil-tops-100': 'Trump says Iran campaign',
    'millions-flee-as-regional-war-widens': 'regional war widens',
    'israel-warns-of-thousands-more-targets-in-iran': 'thousands more targets in Iran',
    'iran-strikes-tel-aviv-with-cluster-missiles': 'Iran strikes Tel Aviv',
    'mediators-pursue-ceasefire-while-iran-nuclear-dispute-persists': 'Iran nuclear dispute',
  },
} as const

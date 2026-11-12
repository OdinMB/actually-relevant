/**
 * How the crawler names itself: the product token publishers address it by in robots.txt, and the
 * user agent every crawler request sends (article pages, RSS feeds, favicons, robots.txt and
 * tdmrep.json). `.context/content-extraction.md`, "Publisher opt-out check".
 */
export const CRAWLER_PRODUCT_TOKEN = 'ActuallyRelevant'

export const CRAWLER_USER_AGENT = `${CRAWLER_PRODUCT_TOKEN}/1.0 (news curation bot; +https://actuallyrelevant.news)`

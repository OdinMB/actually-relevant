// Centralized brand copy used across the site
export const BRAND = {
  claim: 'News that matters to humanity.',
  claimSupport: 'Curated with care by AI.',
} as const

// What a subscriber gets, shown at every newsletter signup. Keep it true: one issue a week (the
// generate_newsletter and publish_newsletter jobs, .context/newsletter-podcast.md), and Plunk puts an
// unsubscribe link in every email. No weekday: Saturday 04:30 UTC is still Friday in the Americas.
export const NEWSLETTER_PROMISE = 'Free, no ads, once a week. Unsubscribe anytime.'

// Canonical public URLs. Use these instead of writing the addresses inline.
export const SITE_URL = 'https://actuallyrelevant.news'
export const KOFI_URL = 'https://ko-fi.com/odinmb'
export const BLUESKY_PROFILE_URL = 'https://bsky.app/profile/actuallyrelevant.bsky.social'
export const MASTODON_PROFILE_URL = 'https://mastodon.social/@actuallyrelevant'
export const GITHUB_REPO_URL = 'https://github.com/OdinMB/actually-relevant'
export const GITHUB_LICENSE_URL = `${GITHUB_REPO_URL}/blob/main/LICENSE`
export const APPLE_PODCASTS_URL = 'https://podcasts.apple.com/us/podcast/actually-relevant/id1751127139'

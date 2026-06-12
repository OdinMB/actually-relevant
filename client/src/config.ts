// Centralized brand copy used across the site
export const BRAND = {
  claim: 'News that matters to humanity.',
  claimSupport: 'Curated with care by AI.',
} as const

export const GITHUB_REPO_URL = 'https://github.com/OdinMB/actually-relevant'
export const GITHUB_LICENSE_URL = `${GITHUB_REPO_URL}/blob/main/LICENSE`

/**
 * Kill-switch for newsletter signups. When `false`, the subscribe form shows a
 * "paused" notice instead of accepting registrations — used while the email
 * provider (Plunk) account is suspended. Flip to `false` and redeploy the client
 * to pause; flip back to `true` once sending is restored.
 */
export const SUBSCRIPTIONS_ENABLED = true

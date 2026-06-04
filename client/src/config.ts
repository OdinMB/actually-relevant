// Centralized brand copy used across the site
export const BRAND = {
  claim: 'News that matters to humanity.',
  claimSupport: 'Curated with care by AI.',
} as const

export const GITHUB_REPO_URL = 'https://github.com/OdinMB/actually-relevant'
export const GITHUB_LICENSE_URL = `${GITHUB_REPO_URL}/blob/main/LICENSE`

/**
 * Newsletter signups are temporarily disabled while the email provider (Plunk)
 * account is suspended. The subscribe form shows a "paused" notice instead of
 * accepting registrations. Flip back to `true` and redeploy the client once
 * sending is restored.
 */
export const SUBSCRIPTIONS_ENABLED = false

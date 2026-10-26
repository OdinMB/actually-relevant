/**
 * Timing of the anti-bot form tokens that the signup and feedback forms post. The server
 * takes a token only while its age is between config.subscribe.minFormFillMs and
 * config.subscribe.formTokenMaxAgeMs, and drops any other while still answering success,
 * so a form must never post one outside that window (.context/subscription.md).
 */

/** Must match config.subscribe.minFormFillMs on the server. */
export const FORM_TOKEN_MIN_AGE_MS = 1500

/** Must match config.subscribe.formTokenMaxAgeMs on the server. */
const FORM_TOKEN_MAX_AGE_MS = 30 * 60 * 1000

/** A form fetches a fresh token once the one it holds is this old, while it is open and seen. */
export const FORM_TOKEN_REFRESH_MS = FORM_TOKEN_MAX_AGE_MS - 10 * 60 * 1000

/**
 * The oldest token a form still posts; an older one is replaced first. The margin covers
 * the human check and the network between this check and the server's.
 */
export const FORM_TOKEN_POST_MAX_AGE_MS = FORM_TOKEN_MAX_AGE_MS - 5 * 60 * 1000

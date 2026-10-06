/**
 * Whether the podcast may spend or publish now. Phase 1 holds only the typed block: the
 * configuration check, the TTS spend reservation and the job-row re-check arrive with the audio
 * phase (.plans/autonomous-two-speaker-podcast.md).
 */

/** A failure that retrying will not fix: the episode is blocked until an admin Resume. */
export class PodcastBlockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PodcastBlockedError'
  }
}

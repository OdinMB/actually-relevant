import { describe, it, expect } from 'vitest'
import { blueskyPostUrl } from './bluesky'

describe('blueskyPostUrl', () => {
  it('turns a post URI into its bsky.app address', () => {
    expect(blueskyPostUrl('at://did:plc:abc123/app.bsky.feed.post/3kxyz')).toBe('https://bsky.app/profile/did:plc:abc123/post/3kxyz')
  })

  it('returns null for a URI that is not a post', () => {
    expect(blueskyPostUrl('at://did:plc:abc123/app.bsky.feed.like/3kxyz')).toBeNull()
    expect(blueskyPostUrl('https://bsky.app/profile/x/post/y')).toBeNull()
  })
})

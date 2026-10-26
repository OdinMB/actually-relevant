/** The bsky.app web address of a post, from its AT Protocol URI (`at://<did>/app.bsky.feed.post/<rkey>`); null for any other URI */
export function blueskyPostUrl(atUri: string): string | null {
  const match = atUri.match(/^at:\/\/(did:[^/]+)\/app\.bsky\.feed\.post\/(.+)$/)
  if (!match) return null
  return `https://bsky.app/profile/${match[1]}/post/${match[2]}`
}

/**
 * Which addresses may become a link or an image source. An address is read the way the browser
 * reads it (`new URL`), so tabs, case and other spellings of `javascript:` are caught; a relative
 * address or one that does not parse counts as none.
 */

function protocolOf(url: string): string | null {
  try {
    return new URL(url).protocol
  } catch {
    return null
  }
}

/** Whether the address is http(s): the only kind fetched or model-written text may link to. */
export const isHttpUrl = (url: string): boolean => protocolOf(url) === 'http:' || protocolOf(url) === 'https:'

/** Whether the address is https. */
export const isHttpsUrl = (url: string): boolean => protocolOf(url) === 'https:'

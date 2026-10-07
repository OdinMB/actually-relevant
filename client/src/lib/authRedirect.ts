/** Carrying an admin URL through the login page and back. */

const DEFAULT_ADMIN_PATH = '/admin'

export interface LoginRedirectState {
  from: string
}

/** The router state for a redirect to login that remembers where the person was. */
export function loginRedirectState(location: { pathname: string; search: string; hash: string }): LoginRedirectState {
  return { from: `${location.pathname}${location.search}${location.hash}` }
}

/**
 * Where to send the person after login: the remembered admin URL (path, query
 * and hash), or the dashboard when there is none or it is not an admin page.
 */
export function postLoginPath(state: unknown): string {
  if (typeof state !== 'object' || state === null || !('from' in state)) return DEFAULT_ADMIN_PATH
  const { from } = state
  if (typeof from !== 'string') return DEFAULT_ADMIN_PATH
  if (!/^\/admin(?=$|[/?#])/.test(from)) return DEFAULT_ADMIN_PATH
  if (/^\/admin\/login(?=$|[/?#])/.test(from)) return DEFAULT_ADMIN_PATH
  return from
}

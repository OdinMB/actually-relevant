import { describe, it, expect } from 'vitest'
import { loginRedirectState, postLoginPath } from './authRedirect'

describe('postLoginPath', () => {
  it('returns to the remembered admin URL with its query and hash', () => {
    const state = loginRedirectState({ pathname: '/admin/podcasts/abc', search: '?tab=script', hash: '#line-4' })
    expect(postLoginPath(state)).toBe('/admin/podcasts/abc?tab=script#line-4')
  })

  it('falls back to the dashboard without a remembered URL', () => {
    expect(postLoginPath(null)).toBe('/admin')
    expect(postLoginPath(undefined)).toBe('/admin')
    expect(postLoginPath({ from: 42 })).toBe('/admin')
  })

  it('never leaves the admin or loops back to the login page', () => {
    expect(postLoginPath({ from: '//evil.example/admin' })).toBe('/admin')
    expect(postLoginPath({ from: 'https://evil.example/admin' })).toBe('/admin')
    expect(postLoginPath({ from: '/administrator' })).toBe('/admin')
    expect(postLoginPath({ from: '/stories/x' })).toBe('/admin')
    expect(postLoginPath({ from: '/admin/login?x=1' })).toBe('/admin')
  })

  it('accepts the dashboard itself', () => {
    expect(postLoginPath({ from: '/admin?range=7d' })).toBe('/admin?range=7d')
  })
})

import { describe, it, expect } from 'vitest'
import { backLink, returnState, storyPath } from './storyReturn'

const at = (pathname: string, search = '', key = 'k1') => ({ pathname, search, key })

describe('returnState', () => {
  it('carries the page a story is opened from, its search and its history entry', () => {
    expect(returnState(at('/admin/stories', '?status=all&sort=rating_desc&page=3', 'list-1'))).toEqual({
      returnTo: { path: '/admin/stories?status=all&sort=rating_desc&page=3', label: 'stories', entry: 'list-1' },
    })
  })

  it.each([
    ['/admin/stories', 'stories'],
    ['/admin/newsletters/n1', 'newsletter'],
    ['/admin/podcasts/p1', 'podcast'],
    ['/admin/feedback', 'previous page'],
  ])('names %s as %s', (pathname, label) => {
    expect(returnState(at(pathname)).returnTo.label).toBe(label)
  })
})

describe('backLink', () => {
  it('goes back to where the story was opened, restoring that entry’s scroll', () => {
    expect(backLink(returnState(at('/admin/stories', '?status=rejected&page=2', 'list-1')))).toEqual({
      to: '/admin/stories?status=rejected&page=2',
      label: 'Back to stories',
      state: { restoreScrollOf: 'list-1' },
    })
  })

  it('restores no scroll when the way back names no entry (a redirect replaced it)', () => {
    expect(backLink(returnState({ pathname: '/admin/stories', search: '?status=all' }))).toEqual({
      to: '/admin/stories?status=all',
      label: 'Back to stories',
      state: undefined,
    })
  })

  it.each([
    ['no state', null],
    ['state without a way back', { other: true }],
    ['a path outside the admin', { returnTo: { path: 'https://example.com/', label: 'stories' } }],
    ['a protocol-relative path', { returnTo: { path: '//example.com/admin', label: 'stories' } }],
    ['a label it does not know', { returnTo: { path: '/admin/stories', label: '<b>' } }],
    ['fields of the wrong type', { returnTo: { path: 7, label: 'stories', entry: 3 } }],
  ])('goes to the stories list for %s', (_, state) => {
    expect(backLink(state)).toEqual({ to: '/admin/stories', label: 'Back to stories', state: undefined })
  })

  it('names a page it has no label for plainly', () => {
    expect(backLink(returnState(at('/admin/feedback', '?status=unread'))).label).toBe('Back to previous page')
  })
})

describe('storyPath', () => {
  it('is the story’s admin page, its id escaped', () => {
    expect(storyPath('abc')).toBe('/admin/stories/abc')
    expect(storyPath('a/b')).toBe('/admin/stories/a%2Fb')
  })
})

import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { loadSitemapRoutes } from './staticRoutes.js'

describe('loadSitemapRoutes', () => {
  let dir: string | undefined

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })

  function fileWith(content: unknown): string {
    dir = mkdtempSync(join(tmpdir(), 'routes-'))
    const file = join(dir, 'routes.json')
    writeFileSync(file, JSON.stringify(content))
    return file
  }

  it('reads shared/routes.json, the list the client prerenders', () => {
    const paths = loadSitemapRoutes().map(r => r.path)
    expect(paths[0]).toBe('/')
    expect(paths).toContain('/feedback')
    expect(paths).toContain('/newsletter')
  })

  it('leaves out a route marked "sitemap": false (/saved, a personal page)', () => {
    const paths = loadSitemapRoutes().map(r => r.path)
    expect(paths).not.toContain('/saved')
  })

  it('leaves out /subscribed, the newsletter confirmation page, which is noindex', () => {
    const paths = loadSitemapRoutes().map(r => r.path)
    expect(paths).not.toContain('/subscribed')
  })

  it('refuses a malformed file, so a bad entry stops the server at boot', () => {
    const file = fileWith({ routes: [{ path: '/x', priority: 2, changefreq: 'daily' }] })
    expect(() => loadSitemapRoutes(file)).toThrow()
  })

  it('refuses an unknown change frequency', () => {
    const file = fileWith({ routes: [{ path: '/x', priority: 0.5, changefreq: 'sometimes' }] })
    expect(() => loadSitemapRoutes(file)).toThrow()
  })
})

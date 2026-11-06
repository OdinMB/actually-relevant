import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { PositivityProvider, usePositivity } from './PositivityContext'
import { setPrerendering } from '../test/prerenderer'

const STORAGE_KEY = 'ar-positivity'

/** Every dial value the provider rendered its children with, in order. */
let rendered: number[] = []

function DialProbe() {
  const { positivity } = usePositivity()
  rendered.push(positivity)
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  return (
    <>
      <div data-testid="dial">{positivity}</div>
      <div data-testid="location">{pathname + search}</div>
      <button onClick={() => navigate('/')}>Go home</button>
      <button onClick={() => navigate('/uplifting')}>Go to the landing page</button>
    </>
  )
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <PositivityProvider>
        <DialProbe />
      </PositivityProvider>
    </MemoryRouter>,
  )
}

const dial = () => Number(screen.getByTestId('dial').textContent)

beforeEach(() => {
  rendered = []
  localStorage.clear()
})

afterEach(() => setPrerendering(false))

describe('PositivityProvider at the Actually Uplifting landing page', () => {
  it.each(['/uplifting', '/uplifting/'])('puts the dial at Only uplifting from the first render at %s, over a stored balanced mix, and stores it', url => {
    localStorage.setItem(STORAGE_KEY, '50')
    renderAt(url)

    expect(rendered[0]).toBe(100)
    expect(dial()).toBe(100)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('100')
  })

  it('lets an explicit ?mix= win over the path', () => {
    renderAt('/uplifting?mix=balanced')

    expect(rendered[0]).toBe(50)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('50')
  })

  it.each(['/uplifting-news', '/issues/uplifting', '/uplifting/more'])('leaves the stored mix alone on other paths, such as %s', url => {
    localStorage.setItem(STORAGE_KEY, '25')
    renderAt(url)

    expect(dial()).toBe(25)
  })

  it('keeps Only uplifting when the reader goes on from the landing page', () => {
    localStorage.setItem(STORAGE_KEY, '50')
    renderAt('/uplifting')

    fireEvent.click(screen.getByRole('button', { name: 'Go home' }))

    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/)
    expect(dial()).toBe(100)
  })

  it('moves the dial to Only uplifting on an in-app link to the landing page', () => {
    localStorage.setItem(STORAGE_KEY, '50')
    renderAt('/')
    expect(dial()).toBe(50)

    fireEvent.click(screen.getByRole('button', { name: 'Go to the landing page' }))

    expect(dial()).toBe(100)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('100')
  })
})

describe('PositivityProvider in the build prerenderer', () => {
  it('ignores the stored mix and writes nothing, so a snapshot always starts balanced', () => {
    setPrerendering(true)
    localStorage.setItem(STORAGE_KEY, '100')
    renderAt('/about')

    expect(rendered[0]).toBe(50)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('100')
  })

  it('renders the landing page at Only uplifting without storing it for the pages snapshotted after it', () => {
    setPrerendering(true)
    renderAt('/uplifting')

    expect(rendered[0]).toBe(100)
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})

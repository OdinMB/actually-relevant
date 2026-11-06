import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { Link, MemoryRouter, useLocation, useNavigationType } from 'react-router-dom'
import { PositivityProvider } from '../../contexts/PositivityContext'
import { focusRingProblems, isBox, sizeByBreakpoint } from '../../test/classes'
import UpliftingEditionRow from './UpliftingEditionRow'

// jsdom has no modal dialog support: opening and closing only toggle the `open` attribute here.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
})

/** How the last navigation went (PUSH or REPLACE) and where it led. */
function NavigationProbe() {
  const { pathname, search, hash } = useLocation()
  return <div data-testid="navigation">{`${useNavigationType()} ${pathname}${search}${hash}`}</div>
}

function renderRow(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <PositivityProvider>
        <UpliftingEditionRow />
        <main>
          <NavigationProbe />
        </main>
        {/* Another way in and out of the edition than the row's own link, as the browser's Back button is */}
        <Link to="/?mix=balanced">Elsewhere, balanced</Link>
        <Link to="/?mix=uplifting">Elsewhere, uplifting</Link>
      </PositivityProvider>
    </MemoryRouter>,
  )
}

const infoButton = () => screen.queryByRole('button', { name: 'About Actually Uplifting' })
const dialog = () => screen.getByRole('dialog', { name: 'Actually Uplifting' })

async function openAbout(url = '/uplifting') {
  const user = userEvent.setup()
  renderRow(url)
  await user.click(infoButton()!)
  return { user, dialog: dialog() }
}

describe('UpliftingEditionRow', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('has an info button: a box at least 24x24 that shows only the brand ring on keyboard focus', () => {
    renderRow('/uplifting')
    const button = infoButton()!

    expect(isBox(button)).toBe(true)
    for (const axis of ['w', 'h'] as const) expect(sizeByBreakpoint(button, axis).get(''), axis).toBeGreaterThanOrEqual(24)
    expect(focusRingProblems(button)).toEqual([])
  })

  it('opens the dialog from the info button, focus on its heading so a screen reader starts at the explanation', async () => {
    const { dialog } = await openAbout()

    expect(dialog).toHaveAttribute('open')
    await waitFor(() => expect(within(dialog).getByRole('heading', { name: 'Actually Uplifting' })).toHaveFocus())
  })

  it('closes on Escape and gives focus back to the info button', async () => {
    const { dialog } = await openAbout()

    // What a browser does on Escape in a modal dialog, which jsdom does not
    fireEvent(dialog, new Event('cancel', { cancelable: true }))

    expect(dialog).not.toHaveAttribute('open')
    expect(infoButton()).toHaveFocus()
  })

  it.each([
    { from: '/uplifting', to: /^PUSH \/\?mix=balanced$/, how: 'the landing page for the homepage, as a new history entry' },
    {
      from: '/search?q=x&mix=uplifting#results',
      to: /^REPLACE \/search\?q=x&mix=balanced#results$/,
      how: 'any other page for itself, hash kept, history replaced',
    },
  ])('leaves the edition from the dialog as the row does, from $how: dialog and row gone, focus on <main>', async ({ from, to }) => {
    const { user, dialog } = await openAbout(from)

    await user.click(within(dialog).getByRole('link', { name: 'See all news' }))

    expect(screen.getByTestId('navigation')).toHaveTextContent(to)
    expect(infoButton()).toBeNull()
    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull()
    expect(screen.getByRole('main')).toHaveFocus()
  })

  it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }])(
    'keeps the dialog open and the page as it is on a click on its link that opens a new tab or window (%o)',
    async init => {
      const { dialog } = await openAbout()
      // jsdom does not open tabs: stop the browser's own follow-through once the app has seen the click
      const stopDefault = (event: Event) => event.preventDefault()
      window.addEventListener('click', stopDefault)
      window.addEventListener('auxclick', stopDefault)
      try {
        fireEvent.click(within(dialog).getByRole('link', { name: 'See all news' }), init)
      } finally {
        window.removeEventListener('click', stopDefault)
        window.removeEventListener('auxclick', stopDefault)
      }

      expect(dialog).toHaveAttribute('open')
      expect(screen.getByTestId('navigation')).toHaveTextContent(/^POP \/uplifting$/)
    },
  )

  it('starts closed when the reader comes back to the edition after leaving it with the dialog open', async () => {
    // jsdom leaves the page around an open dialog clickable, so these links stand in for Back and Forward
    const { user } = await openAbout()

    await user.click(screen.getByRole('link', { name: 'Elsewhere, balanced' }))
    expect(infoButton()).toBeNull()
    await user.click(screen.getByRole('link', { name: 'Elsewhere, uplifting' }))

    expect(infoButton()).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('has no a11y violations with the dialog open', async () => {
    const { dialog } = await openAbout()

    expect(await axe(dialog)).toHaveNoViolations()
  })
})

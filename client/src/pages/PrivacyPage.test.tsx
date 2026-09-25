import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HelmetProvider } from 'react-helmet-async'
import PrivacyPage from './PrivacyPage'

function renderPrivacy() {
  return render(
    <HelmetProvider>
      <PrivacyPage />
    </HelmetProvider>,
  )
}

/** The page's text with whitespace collapsed, so assertions ignore the JSX line breaks. */
function pageText(container: HTMLElement): string {
  return container.textContent!.replace(/\s+/g, ' ')
}

describe('PrivacyPage', () => {
  it('names OpenAI as the recipient of search queries, with the possible transfer to the USA', () => {
    const { container } = renderPrivacy()
    expect(pageText(container)).toContain(
      'When you search, we send your query to OpenAI to match it with stories. ' +
        'OpenAI processes it on our behalf, which may involve a transfer to the USA. ' +
        'We also use OpenAI models to analyze news articles, which involves no visitor data.',
    )
    // In the recipients section
    const recipients = screen.getByRole('heading', { name: 'Third-Party Services' })
    const openAi = screen.getByText(/When you search, we send your query to OpenAI/)
    expect(recipients.compareDocumentPosition(openAi) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('says what the browser keeps on the device, instead of claiming nothing is stored', () => {
    const { container } = renderPrivacy()
    expect(pageText(container)).toContain(
      'Your browser keeps your dial position, saved stories, and reading history on your device, and they never leave it.',
    )
    expect(pageText(container)).not.toContain('nothing is stored on your device')
    expect(pageText(container)).not.toContain('The only data stored on your device')
  })
})

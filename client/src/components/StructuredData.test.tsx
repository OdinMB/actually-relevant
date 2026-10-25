import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import StructuredData from './StructuredData'

describe('StructuredData', () => {
  it('keeps a hostile title inside its own script element in the serialized HTML', () => {
    const hostile = { headline: '</script><script>alert(1)</script>' }
    const { container } = render(<StructuredData data={[hostile, { b: 2 }]} />)

    // Re-parse the serialized markup, as a crawler reads prerendered HTML.
    const reparsed = new DOMParser().parseFromString(`<body>${container.innerHTML}</body>`, 'text/html')
    const scripts = reparsed.querySelectorAll('script')
    expect(scripts).toHaveLength(2)
    expect(JSON.parse(scripts[0]!.textContent ?? '')).toEqual(hostile)
  })
})

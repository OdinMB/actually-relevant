import { Component } from 'react'
import type { ReactNode, ErrorInfo } from 'react'

interface Props {
  children: ReactNode
  /**
   * Shown in place of the children when they fail to load or render. Without it the boundary
   * takes over the screen with a full-page "Failed to load page" and its own h1, which suits a
   * whole route; a widget inside a page passes an inline fallback so the rest of the page stays.
   */
  fallback?: ReactNode
}

interface State {
  hasError: boolean
}

export class ChunkErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ChunkErrorBoundary caught error:', error, info)
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children
    }

    if (this.props.fallback !== undefined) {
      return this.props.fallback
    }

    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-sm text-center">
          <h1 className="text-xl font-bold text-neutral-900 mb-2">Failed to load page</h1>
          <p className="text-sm text-neutral-600 mb-6">A newer version may have been deployed. Reload to get the latest.</p>
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center justify-center rounded-md bg-brand-700 px-4 py-2 text-sm font-normal text-white hover:bg-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
          >
            Reload page
          </button>
        </div>
      </div>
    )
  }
}

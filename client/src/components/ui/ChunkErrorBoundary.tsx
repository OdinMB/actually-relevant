import { Component } from 'react'
import type { ReactNode, ErrorInfo } from 'react'

interface Props {
  children: ReactNode
  /**
   * Shown in place of the children when they fail to load or render. Without it the boundary
   * takes over the screen with its own full-page error screen and h1, which suits a
   * whole route; a widget inside a page passes an inline fallback so the rest of the page stays.
   */
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  /** The caught error is a failed chunk download (usually a deploy replaced the file), not a render crash. */
  chunkLoadFailed: boolean
}

export class ChunkErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, chunkLoadFailed: false }
  }

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, chunkLoadFailed: isChunkLoadError(error) }
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
          <h1 className="text-xl font-bold text-neutral-900 mb-2">{this.state.chunkLoadFailed ? 'Failed to load page' : 'Something went wrong'}</h1>
          <p className="text-sm text-neutral-600 mb-6">
            {this.state.chunkLoadFailed
              ? 'A newer version may have been deployed. Reload to get the latest.'
              : 'Reload the page to try again, or go to the homepage.'}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center justify-center rounded-md bg-brand-700 px-4 py-2 text-sm font-normal text-white hover:bg-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
          >
            Reload page
          </button>
          {!this.state.chunkLoadFailed && (
            <p className="mt-4">
              <a
                href="/"
                className="inline-block rounded px-1 text-sm leading-6 text-brand-700 underline underline-offset-2 hover:text-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                Go to the homepage
              </a>
            </p>
          )}
        </div>
      </div>
    )
  }
}

/**
 * Messages browsers and bundlers give a lazy chunk that could not be downloaded:
 * Chromium, Firefox, Safari (including an HTML page served in place of a missing file),
 * Vite's CSS preload, and webpack-style "Loading chunk … failed".
 */
const CHUNK_LOAD_MESSAGE =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|is not a valid JavaScript MIME type|Unable to preload CSS|Loading (CSS )?chunk .+ failed/i

function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.name === 'ChunkLoadError' || CHUNK_LOAD_MESSAGE.test(error.message)
}

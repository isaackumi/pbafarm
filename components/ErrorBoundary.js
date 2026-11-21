import { Component } from 'react'
import ErrorState from './states/ErrorState'
import { captureException } from '../lib/monitoring'
import { newErrorId } from '../lib/errorId'

/**
 * Catches render errors below it so a crash shows a message and a way out
 * instead of a blank page. `resetKey` (e.g. the route) clears the error when
 * it changes, so navigating away recovers without a full reload.
 * Pass `silent` to render nothing instead of the fallback.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, errorId: null }
  }

  static getDerivedStateFromError(error) {
    return { error, errorId: newErrorId() }
  }

  componentDidCatch(error, info) {
    // Browser console, plus Sentry when NEXT_PUBLIC_SENTRY_DSN is set.
    console.error('Unhandled render error', this.state.errorId, error, info?.componentStack)
    captureException(error, {
      source: this.props.root ? 'root-boundary' : 'error-boundary',
      tags: this.state.errorId ? { errorId: this.state.errorId } : undefined,
    })
  }

  componentDidUpdate(prevProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null, errorId: null })
    }
  }

  render() {
    if (!this.state.error) return this.props.children
    // `silent` boundaries (e.g. the floating assistant) just disappear so a
    // side widget cannot take the whole page down.
    if (this.props.silent) return null
    // The root boundary sits outside every provider, so its fallback cannot
    // rely on theme, i18n or UI components that may be what crashed.
    if (this.props.root) return <RootErrorFallback />
    return <ErrorFallback errorId={this.state.errorId} onRetry={() => this.setState({ error: null, errorId: null })} />
  }
}

/** In-app crash screen (Paper 62 _error card). "Try again" re-renders the crashed tree. */
export function ErrorFallback({ title, description, errorId, onRetry }) {
  return <ErrorState title={title} description={description} errorId={errorId} onRetry={onRetry} />
}

/**
 * Dependency-free fallback for the outermost boundary in pages/_app.js: no
 * providers, so plain markup with the theme's CSS variables (system colours
 * if even the stylesheet is missing).
 */
export function RootErrorFallback() {
  return (
    <div
      role="alert"
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        fontFamily: 'var(--font-sans, system-ui, sans-serif)',
        background: 'var(--bg, Canvas)',
        color: 'var(--text, CanvasText)',
      }}
    >
      <div
        style={{
          maxWidth: 440,
          textAlign: 'center',
          padding: 32,
          borderRadius: 20,
          border: '1px solid var(--line, GrayText)',
          background: 'var(--surface, Canvas)',
        }}
      >
        <h1 style={{ fontSize: 22, lineHeight: '28px', fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>
          Something went wrong
        </h1>
        <p style={{ fontSize: 14, lineHeight: '20px', marginTop: 8, color: 'var(--muted, GrayText)' }}>
          Your saved data is safe. Reload the page to try again. If it keeps happening, tell your administrator what you
          were doing.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            marginTop: 18,
            padding: '11px 22px',
            borderRadius: 999,
            border: 0,
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            background: 'var(--button, ButtonFace)',
            color: 'var(--button-text, ButtonText)',
          }}
        >
          Reload page
        </button>
      </div>
    </div>
  )
}

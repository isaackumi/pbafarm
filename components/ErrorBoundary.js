import { Component } from 'react'
import { Button, Card } from './ui'
import { captureException } from '../lib/monitoring'

/**
 * Catches render errors below it so a crash shows a message and a way out
 * instead of a blank page. `resetKey` (e.g. the route) clears the error when
 * it changes, so navigating away recovers without a full reload.
 * Pass `silent` to render nothing instead of the fallback.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Browser console, plus Sentry when NEXT_PUBLIC_SENTRY_DSN is set.
    console.error('Unhandled render error', error, info?.componentStack)
    captureException(error, { source: this.props.root ? 'root-boundary' : 'error-boundary' })
  }

  componentDidUpdate(prevProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
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
    return <ErrorFallback />
  }
}

export function ErrorFallback({
  title = 'Something went wrong on this page',
  description = 'Your saved data is safe. Reload the page to try again. If it keeps happening, tell your administrator what you were doing.',
}) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4 py-10 bg-foam">
      <Card className="max-w-md w-full text-center">
        <h1 className="font-display text-xl font-medium text-chart-ink">{title}</h1>
        <p className="text-sm text-muted mt-2">{description}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button onClick={() => window.location.reload()}>Reload page</Button>
          <Button variant="secondary" href="/dashboard">
            Go to dashboard
          </Button>
        </div>
      </Card>
    </div>
  )
}

/** Dependency-free fallback for the outermost boundary in pages/_app.js. */
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
        fontFamily: 'system-ui, sans-serif',
        background: '#f5f8f9',
        color: '#12323f',
      }}
    >
      <div style={{ maxWidth: 420, textAlign: 'center' }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Something went wrong</h1>
        <p style={{ fontSize: 14, marginTop: 8 }}>
          Your saved data is safe. Reload the page to try again. If it keeps happening, tell your administrator what you
          were doing.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{ marginTop: 16, padding: '8px 16px', borderRadius: 6, border: '1px solid #12323f', background: '#fff' }}
        >
          Reload page
        </button>
      </div>
    </div>
  )
}

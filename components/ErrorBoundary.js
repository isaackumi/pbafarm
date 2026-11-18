import { Component } from 'react'
import { Button, Card } from './ui'

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
    // Visible in the browser console and any future monitoring hook.
    console.error('Unhandled render error', error, info?.componentStack)
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

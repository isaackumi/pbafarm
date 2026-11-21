import { Component } from 'react'
import { authErrorCode } from '../convex/lib/authErrors'
import { captureException } from '../lib/monitoring'
import { newErrorId } from '../lib/errorId'
import ErrorState from './states/ErrorState'

/**
 * Failed loads below this point show the Paper 62 _error card (HMM-0 / KRK-0:
 * "Something went wrong", the error id chip, "Try again") instead of a blank
 * or crashed page (UX-001). Convex `useQuery` throws a failed query during
 * render; "Try again" remounts the children, which subscribes again.
 *
 * `title` / `description` override Paper's copy only where the failure has a
 * specific meaning (billing: not an owner or admin); `description={null}`
 * drops the body line.
 *
 * Access refusals (signed out, account disabled) are re-thrown so the app's
 * AuthErrorBoundary can sign out or redirect. `resetKey` (e.g. the route)
 * clears the error when it changes.
 */
export default class QueryBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, errorId: null, attempt: 0 }
    this.retry = this.retry.bind(this)
  }

  static getDerivedStateFromError(error) {
    return { error, errorId: authErrorCode(error) ? null : newErrorId() }
  }

  componentDidCatch(error, info) {
    if (authErrorCode(error)) return
    // Browser console, plus Sentry when NEXT_PUBLIC_SENTRY_DSN is set; the id
    // on the card is the one in the report.
    console.error('Load failed', this.state.errorId, error, info?.componentStack)
    captureException(error, {
      source: 'query-boundary',
      tags: this.state.errorId ? { errorId: this.state.errorId } : undefined,
    })
  }

  componentDidUpdate(prevProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null, errorId: null })
    }
  }

  retry() {
    this.setState((s) => ({ error: null, errorId: null, attempt: s.attempt + 1 }))
  }

  render() {
    const { error, errorId, attempt } = this.state
    if (error) {
      if (authErrorCode(error)) throw error
      const { title, description, className } = this.props
      return (
        <ErrorState
          title={title}
          description={description}
          errorId={errorId}
          onRetry={this.retry}
          className={className}
        />
      )
    }
    // A new key on retry remounts the subtree so every query subscribes again.
    return <QueryAttempt key={attempt}>{this.props.children}</QueryAttempt>
  }
}

function QueryAttempt({ children }) {
  return children
}

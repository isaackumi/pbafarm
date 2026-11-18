import { Component } from 'react'
import { authErrorCode } from '../convex/lib/authErrors'
import { ErrorState } from './ui'

/**
 * Failed loads below this point show an error with a retry instead of a
 * blank or crashed page (UX-001). Convex `useQuery` throws a failed query
 * during render; "Try again" remounts the children, which subscribes again.
 *
 * Access refusals (signed out, account disabled) are re-thrown so the app's
 * AuthErrorBoundary can sign out or redirect. `resetKey` (e.g. the route)
 * clears the error when it changes.
 */
export default class QueryBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, attempt: 0 }
    this.retry = this.retry.bind(this)
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    if (!authErrorCode(error)) console.error('Load failed', error, info?.componentStack)
  }

  componentDidUpdate(prevProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  retry() {
    this.setState((s) => ({ error: null, attempt: s.attempt + 1 }))
  }

  render() {
    const { error, attempt } = this.state
    if (error) {
      if (authErrorCode(error)) throw error
      return <ErrorState title={this.props.title} onRetry={this.retry} className={this.props.className} />
    }
    // A new key on retry remounts the subtree so every query subscribes again.
    return <QueryAttempt key={attempt}>{this.props.children}</QueryAttempt>
  }
}

function QueryAttempt({ children }) {
  return children
}

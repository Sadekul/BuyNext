import { Component } from 'react'
import { LuTriangleAlert } from 'react-icons/lu'
import { reportError } from '../utils/errorReporting'

/**
 * Phase 9: catches a crash while rendering the admin, reports it once
 * (utils/errorReporting.js → POST /api/client-errors), and shows a way out
 * instead of a blank page.
 */
class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    reportError(error, info)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <main className="state state--error" role="alert">
        <LuTriangleAlert aria-hidden="true" />
        <h1>Something went wrong on this page</h1>
        <p>The problem was reported to BuyNest. Reload the page to try again; your saved changes are safe.</p>
        <button type="button" className="btn btn--outline btn--sm" onClick={() => window.location.reload()}>
          Reload
        </button>
      </main>
    )
  }
}

export default ErrorBoundary

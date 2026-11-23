import { Component } from 'react'
import { LuTriangleAlert } from 'react-icons/lu'
import Button from '../ui/Button'
import { ROUTES } from '../../constants/routes'
import { reportError } from '../../utils/errorReporting'
import { translate } from '../../i18n'

/**
 * Catches errors thrown while RENDERING its children and shows a fallback
 * instead of a blank page. Error boundaries must be class components: there
 * is no hook equivalent of getDerivedStateFromError / componentDidCatch.
 *
 * Not caught: errors in event handlers, async code (promises, timers), or
 * the boundary itself — handle those with try/catch and error state.
 *
 * Give it a `key` (e.g. the URL path) so navigating away resets it.
 */
class ErrorBoundary extends Component {
  state = { error: null }

  // Render phase: switch to the fallback UI on the next render.
  static getDerivedStateFromError(error) {
    return { error }
  }

  // Commit phase: the place to report the error. Phase 9: BuyNest's own
  // reporter (utils/errorReporting.js) sends it to the server, once.
  componentDidCatch(error, info) {
    reportError(error, info)
    this.props.onError?.(error, info)
  }

  reset = () => this.setState({ error: null })

  render() {
    if (!this.state.error) return this.props.children
    if (this.props.fallback) return this.props.fallback({ error: this.state.error, reset: this.reset })

    // A failed lazy-loaded chunk usually means a new version was deployed.
    const isChunkError = /dynamically imported module|Loading chunk/i.test(this.state.error.message)

    return (
      <div className="feedback feedback--error section container" role="alert">
        <LuTriangleAlert className="feedback__icon" aria-hidden="true" />
        <h1 className="feedback__title">{translate('errors:boundary.title')}</h1>
        <p className="feedback__message">{translate(isChunkError ? 'errors:boundary.chunk' : 'errors:boundary.sorry')}</p>
        <div className="feedback__actions">
          {isChunkError ? (
            <Button onClick={() => window.location.reload()}>{translate('errors:boundary.reload')}</Button>
          ) : (
            <Button onClick={this.reset}>{translate('errors:boundary.tryAgain')}</Button>
          )}
          <Button to={ROUTES.home} variant="outline" onClick={this.reset}>
            {translate('errors:boundary.home')}
          </Button>
        </div>
      </div>
    )
  }
}

export default ErrorBoundary

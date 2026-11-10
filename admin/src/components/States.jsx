import { NoPermission } from './NoPermission'
import { LuInbox, LuTriangleAlert } from 'react-icons/lu'

export function Loading({ label = 'Loading…' }) {
  return (
    <p className="state" role="status">
      <span className="spinner" aria-hidden="true" />
      {label}
    </p>
  )
}

export function ErrorState({ error, onRetry }) {
  // The role lacks a permission (403 permission_denied): say which, not "try again".
  if (error?.code === 'permission_denied') return <NoPermission permission={error.permission} />
  return (
    <div className="state state--error" role="alert">
      <LuTriangleAlert aria-hidden="true" />
      <p>{error?.message ?? 'Something went wrong.'}</p>
      {onRetry && (
        <button type="button" className="btn btn--outline btn--sm" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}

export function Empty({ children }) {
  return (
    <p className="state">
      <LuInbox aria-hidden="true" />
      {children}
    </p>
  )
}

import './Loader.css'

/** Accessible loading spinner. `role="status"` makes screen readers announce the label. */
function Loader({ label = 'Loading…', size = 'md' }) {
  return (
    <div className={`loader loader--${size}`} role="status">
      <span className="loader__spinner" aria-hidden="true" />
      <span className="loader__label">{label}</span>
    </div>
  )
}

export default Loader

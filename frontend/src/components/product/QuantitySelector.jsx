import { LuMinus, LuPlus } from 'react-icons/lu'
import './QuantitySelector.css'

/**
 * Controlled quantity stepper: the parent owns `value`. Buttons can never
 * produce a value outside [min, max], so invalid quantities are impossible.
 * Reused by the product page and the cart (Phase 6).
 */
function QuantitySelector({ value, min = 1, max, onChange, label = 'Quantity', size = 'md' }) {
  return (
    <div className={`quantity-selector quantity-selector--${size}`} role="group" aria-label={label}>
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        aria-label="Decrease quantity"
      >
        <LuMinus aria-hidden="true" />
      </button>
      <output aria-live="polite">{value}</output>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        aria-label="Increase quantity"
      >
        <LuPlus aria-hidden="true" />
      </button>
    </div>
  )
}

export default QuantitySelector

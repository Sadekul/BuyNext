import { SHIPPING_RULES } from '../../constants/store'
import { formatPrice } from '../../utils/formatters'
import './FreeShippingProgress.css'

/**
 * "Add $X more for free shipping" with a progress bar. `threshold` is the
 * store's (server settings in REAL_SHOP); none means the store has no free
 * shipping, so nothing is shown.
 */
function FreeShippingProgress({ amountRemaining, threshold = SHIPPING_RULES.freeShippingThreshold }) {
  if (!threshold || amountRemaining === null || amountRemaining === undefined) return null
  const percent = Math.min(100, ((threshold - amountRemaining) / threshold) * 100)

  return (
    <div className="shipping-progress">
      <p>
        {amountRemaining > 0 ? (
          <>
            Add <strong>{formatPrice(amountRemaining)}</strong> more for free shipping
          </>
        ) : (
          <strong>You've unlocked free shipping</strong>
        )}
      </p>
      <progress max={100} value={percent} aria-label="Progress toward free shipping" />
    </div>
  )
}

export default FreeShippingProgress

import { SHIPPING_RULES } from '../../constants/store'
import { formatPrice } from '../../utils/formatters'
import './FreeShippingProgress.css'

/** "Add $X more for free shipping" with a progress bar. */
function FreeShippingProgress({ amountRemaining }) {
  const { freeShippingThreshold } = SHIPPING_RULES
  const percent = Math.min(100, ((freeShippingThreshold - amountRemaining) / freeShippingThreshold) * 100)

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

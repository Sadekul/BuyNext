import { formatBasePrice } from '../../utils/formatters'
import { useDisplayCurrency } from '../../utils/displayCurrency'

/**
 * Phase 11 §5: shown in the cart and at checkout while prices are displayed
 * in another currency: the shopper pays the base amount (USD), not the
 * converted one. Nothing is shown in the base currency.
 */
function ChargedInBaseNote({ amount, className = 'cart-summary__note' }) {
  const { active } = useDisplayCurrency()
  if (!active) return null
  // Without a final amount (the mini cart shows only the subtotal), say which
  // currency is charged without naming a total that shipping may still change.
  return (
    <p className={`${className} currency-note`}>
      Prices in {active.code} are approximate.{' '}
      {typeof amount === 'number' ? <>You&apos;ll be charged {formatBasePrice(amount)} USD.</> : <>You&apos;ll be charged in USD.</>}
    </p>
  )
}

export default ChargedInBaseNote

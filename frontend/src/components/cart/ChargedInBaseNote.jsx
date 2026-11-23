import { formatBasePrice } from '../../utils/formatters'
import { useDisplayCurrency } from '../../utils/displayCurrency'
import { useTranslation } from 'react-i18next'

/**
 * Phase 11 §5: shown in the cart and at checkout while prices are displayed
 * in another currency: the shopper pays the base amount (phase 12: in the
 * store currency, USD or BDT), not the converted one. Nothing is shown in the base currency.
 */
function ChargedInBaseNote({ amount, className = 'cart-summary__note' }) {
  const { t } = useTranslation('cart')
  const { active, store } = useDisplayCurrency()
  if (!active) return null
  // Without a final amount (the mini cart shows only the subtotal), say which
  // currency is charged without naming a total that shipping may still change.
  return (
    <p className={`${className} currency-note`}>
      {t('currencyNote.approximate', { code: active.code })}{' '}
      {typeof amount === 'number' ? t('currencyNote.chargedAmount', { amount: formatBasePrice(amount), code: store.code }) : t('currencyNote.chargedIn', { code: store.code })}
    </p>
  )
}

export default ChargedInBaseNote

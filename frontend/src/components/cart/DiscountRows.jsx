import { formatPrice } from '../../utils/formatters'
import { useTranslation } from 'react-i18next'

/** "Spend $50, get 10% off" or "Ten percent off (NEST10)": the code only when the label doesn't already say it. */
const ruleName = (rule) => (rule.code && rule.label !== rule.code ? `${rule.label} (${rule.code})` : rule.label)

/**
 * The discount rows of a summary (inside a <dl className="cart-summary__rows">).
 * Phase 7 (REAL_SHOP): one row per cart price rule the server applied, an
 * automatic rule ("Spend $50, get 10% off") and a typed code alike, with what
 * each saved, or "Free shipping". Otherwise (the demo, older orders): one
 * "Discount (CODE)" row with the total discount.
 * `format`: formatPrice (cart: the display currency) or formatBasePrice (orders: what is charged).
 */
function DiscountRows({ rules, discount, couponCode, format = formatPrice }) {
  const { t } = useTranslation('cart')
  const shown = (rules ?? []).filter((rule) => rule.discount > 0 || rule.freeShipping)
  if (shown.length > 0) {
    return shown.map((rule, index) => (
      <div key={rule.id ?? `${rule.label}-${index}`} className="cart-summary__saving">
        <dt>{ruleName(rule)}</dt>
        <dd>
          {rule.discount > 0 ? `−${format(rule.discount)}` : null}
          {rule.discount > 0 && rule.freeShipping ? ' + ' : null}
          {rule.freeShipping ? t('discount.freeShipping') : null}
        </dd>
      </div>
    ))
  }
  if (!(discount > 0)) return null
  return (
    <div className="cart-summary__saving">
      <dt>{couponCode ? t('discount.withCode', { code: couponCode }) : t('discount.label')}</dt>
      <dd>−{format(discount)}</dd>
    </div>
  )
}

export default DiscountRows

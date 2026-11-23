import { SHIPPING_RULES } from '../../constants/store'
import { formatPrice } from '../../utils/formatters'
import './FreeShippingProgress.css'
import { Trans, useTranslation } from 'react-i18next'

/**
 * "Add $X more for free shipping" with a progress bar. `threshold` is the
 * store's (server settings in REAL_SHOP); none means the store has no free
 * shipping, so nothing is shown.
 */
function FreeShippingProgress({ amountRemaining, threshold = SHIPPING_RULES.freeShippingThreshold }) {
  const { t } = useTranslation('cart')
  if (!threshold || amountRemaining === null || amountRemaining === undefined) return null
  const percent = Math.min(100, ((threshold - amountRemaining) / threshold) * 100)

  return (
    <div className="shipping-progress">
      <p>
        {amountRemaining > 0 ? (
          <Trans t={t} i18nKey="freeShipping.add" values={{ amount: formatPrice(amountRemaining) }} components={{ strong: <strong /> }} />
        ) : (
          <strong>{t('freeShipping.unlocked')}</strong>
        )}
      </p>
      <progress max={100} value={percent} aria-label={t('freeShipping.progress')} />
    </div>
  )
}

export default FreeShippingProgress

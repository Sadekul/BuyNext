import { formatNumber } from '../../utils/formatters'
import { LuMinus, LuPlus } from 'react-icons/lu'
import './QuantitySelector.css'
import { useTranslation } from 'react-i18next'

/**
 * Controlled quantity stepper: the parent owns `value`. Buttons can never
 * produce a value outside [min, max], so invalid quantities are impossible.
 * Reused by the product page and the cart (Phase 6).
 */
function QuantitySelector({ value, min = 1, max, onChange, label, size = 'md' }) {
  const { t } = useTranslation('catalog')
  return (
    <div className={`quantity-selector quantity-selector--${size}`} role="group" aria-label={label ?? t('quantity.label')}>
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        aria-label={t('quantity.decrease')}
      >
        <LuMinus aria-hidden="true" />
      </button>
      <output aria-live="polite">{formatNumber(value)}</output>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        aria-label={t('quantity.increase')}
      >
        <LuPlus aria-hidden="true" />
      </button>
    </div>
  )
}

export default QuantitySelector

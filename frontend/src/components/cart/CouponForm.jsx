import { useId, useState } from 'react'
import { LuTicket, LuX } from 'react-icons/lu'
import Button from '../ui/Button'
import { REAL_SHOP } from '../../constants/shop'
import './CouponForm.css'
import { useTranslation } from 'react-i18next'

/**
 * Discount code input. The draft text is local state; the applied code
 * lives in the cart. Validation messages come from the cart totals.
 * `disabled` locks it while checkout is placing the order, so the total
 * can't change between clicking "Place order" and recording it.
 * `checking`: the server is deciding about the code (REAL_SHOP).
 */
function CouponForm({ appliedCode, coupon, couponError, onApply, onRemove, disabled = false, checking = false }) {
  const { t } = useTranslation('cart')
  const [draft, setDraft] = useState('')
  const inputId = useId()
  const messageId = useId()

  function handleSubmit(event) {
    event.preventDefault()
    if (!draft.trim()) return
    onApply(draft)
    setDraft('')
  }

  // Phase 13: the demo's own codes are described in the shopper's language; the server's come translated.
  const description = coupon && (!REAL_SHOP && appliedCode ? t(`coupons.${appliedCode}`, { defaultValue: coupon.description }) : coupon.description)
  let message = null
  if (appliedCode && checking && !coupon && !couponError) message = t('coupon.checking', { code: appliedCode })
  else if (appliedCode) message = couponError ? `${appliedCode}: ${couponError}` : coupon && `${appliedCode}: ${description}`

  return (
    <div className="coupon-form">
      {appliedCode ? (
        <div className="coupon-form__applied">
          <p className={couponError ? 'coupon-form__error' : 'coupon-form__success'}>
            <LuTicket aria-hidden="true" />
            <span>
              <strong>{appliedCode}</strong>
              {couponError ? ` — ${couponError}` : coupon ? ` — ${description}` : checking && t('coupon.checkingShort')}
            </span>
          </p>
          <button type="button" className="coupon-form__remove" onClick={onRemove} disabled={disabled} aria-label={t('coupon.removeLabel', { code: appliedCode })}>
            <LuX aria-hidden="true" />
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <fieldset disabled={disabled} className="coupon-form__fieldset">
          <label htmlFor={inputId}>{t('coupon.label')}</label>
          <div className="coupon-form__row">
            <input
              id={inputId}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={t('coupon.placeholder')}
              autoComplete="off"
              aria-describedby={messageId}
            />
            <Button type="submit" variant="outline" size="sm">
              {t('coupon.apply')}
            </Button>
          </div>
          <p id={messageId} className="coupon-form__hint">
            {t(REAL_SHOP ? 'coupon.serverHint' : 'coupon.demoHint')}
          </p>
          </fieldset>
        </form>
      )}
      {/* Always rendered so screen readers announce when a code is applied or rejected. */}
      <p className="visually-hidden" role="status">
        {message}
      </p>
    </div>
  )
}

export default CouponForm

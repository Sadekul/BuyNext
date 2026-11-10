import { useId, useState } from 'react'
import { LuTicket, LuX } from 'react-icons/lu'
import Button from '../ui/Button'
import { REAL_SHOP } from '../../constants/shop'
import './CouponForm.css'

/**
 * Discount code input. The draft text is local state; the applied code
 * lives in the cart. Validation messages come from the cart totals.
 * `disabled` locks it while checkout is placing the order, so the total
 * can't change between clicking "Place order" and recording it.
 * `checking`: the server is deciding about the code (REAL_SHOP).
 */
function CouponForm({ appliedCode, coupon, couponError, onApply, onRemove, disabled = false, checking = false }) {
  const [draft, setDraft] = useState('')
  const inputId = useId()
  const messageId = useId()

  function handleSubmit(event) {
    event.preventDefault()
    if (!draft.trim()) return
    onApply(draft)
    setDraft('')
  }

  let message = null
  if (appliedCode && checking && !coupon && !couponError) message = `Checking ${appliedCode}…`
  else if (appliedCode) message = couponError ? `${appliedCode}: ${couponError}` : coupon && `${appliedCode}: ${coupon.description}`

  return (
    <div className="coupon-form">
      {appliedCode ? (
        <div className="coupon-form__applied">
          <p className={couponError ? 'coupon-form__error' : 'coupon-form__success'}>
            <LuTicket aria-hidden="true" />
            <span>
              <strong>{appliedCode}</strong>
              {couponError ? ` — ${couponError}` : coupon ? ` — ${coupon.description}` : checking && ' — checking…'}
            </span>
          </p>
          <button type="button" className="coupon-form__remove" onClick={onRemove} disabled={disabled} aria-label={`Remove code ${appliedCode}`}>
            <LuX aria-hidden="true" />
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <fieldset disabled={disabled} className="coupon-form__fieldset">
          <label htmlFor={inputId}>Discount code</label>
          <div className="coupon-form__row">
            <input
              id={inputId}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="e.g. NEST10"
              autoComplete="off"
              aria-describedby={messageId}
            />
            <Button type="submit" variant="outline" size="sm">
              Apply
            </Button>
          </div>
          <p id={messageId} className="coupon-form__hint">
            {REAL_SHOP ? 'Codes are checked by our server.' : 'Demo codes: NEST10, SAVE20'}
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

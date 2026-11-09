import { useId, useState } from 'react'
import { LuTicket, LuX } from 'react-icons/lu'
import Button from '../ui/Button'
import './CouponForm.css'

/**
 * Discount code input. The draft text is local state; the applied code
 * lives in the cart. Validation messages come from the cart totals.
 */
function CouponForm({ appliedCode, coupon, couponError, onApply, onRemove }) {
  const [draft, setDraft] = useState('')
  const inputId = useId()
  const messageId = useId()

  function handleSubmit(event) {
    event.preventDefault()
    if (!draft.trim()) return
    onApply(draft)
    setDraft('')
  }

  if (appliedCode) {
    return (
      <div className="coupon-form__applied">
        <p className={couponError ? 'coupon-form__error' : 'coupon-form__success'} role="status">
          <LuTicket aria-hidden="true" />
          <span>
            <strong>{appliedCode}</strong>
            {couponError ? ` — ${couponError}` : coupon && ` — ${coupon.description}`}
          </span>
        </p>
        <button type="button" className="coupon-form__remove" onClick={onRemove} aria-label={`Remove code ${appliedCode}`}>
          <LuX aria-hidden="true" />
        </button>
      </div>
    )
  }

  return (
    <form className="coupon-form" onSubmit={handleSubmit}>
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
        Demo codes: NEST10, SAVE20
      </p>
    </form>
  )
}

export default CouponForm

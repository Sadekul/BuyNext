import { useId, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { LuGift, LuX } from 'react-icons/lu'
import Button from '../ui/Button'
import { checkGiftCard } from '../../services/shopService'
import { formatBasePrice } from '../../utils/formatters'
import { normalizeGiftCardCode } from '../../utils/giftCards'
import '../cart/CouponForm.css'

/**
 * The checkout's "Gift card" field (phase 10, one card per order). Apply
 * first checks the card's balance (POST /api/shop/gift-cards/check), then
 * hands the code to the checkout (`onApply`), which has the server price the
 * order with it. The server's answer (`applied`: what the card pays,
 * `error`: why it can't be used) is shown here and announced.
 * Like the discount code, it is its own <form>, outside the checkout form.
 */
function GiftCardRedeem({ appliedCode, applied, error, onApply, onRemove, disabled = false, checking = false }) {
  const [draft, setDraft] = useState('')
  const inputId = useId()
  const hintId = useId()
  const errorId = useId()
  const check = useMutation({
    mutationFn: (code) => checkGiftCard(code),
    onSuccess: (card, code) => {
      if (card.status !== 'active' || card.balance <= 0) return
      onApply(code)
      setDraft('')
    },
  })

  function handleSubmit(event) {
    event.preventDefault()
    const code = normalizeGiftCardCode(draft)
    if (!code) return
    check.mutate(code)
  }

  const card = check.data
  let checkError = check.error ? (check.error.status === 429 ? 'Too many tries. Please wait a minute and try again.' : check.error.message) : null
  if (!checkError && card && card.status !== 'active') checkError = card.status === 'expired' ? 'This gift card has expired.' : "This gift card can't be used."
  if (!checkError && card && card.balance <= 0) checkError = 'This gift card has no balance left.'
  const last4 = appliedCode ? appliedCode.slice(-4) : null

  let message = null
  if (appliedCode && checking && !applied && !error) message = 'Checking your gift card…'
  else if (appliedCode && error) message = `Gift card ending ${last4}: ${error}`
  else if (appliedCode && applied) {
    message = `Gift card ending ${last4} pays ${formatBasePrice(applied.applied)}.${applied.remaining !== null ? ` ${formatBasePrice(applied.remaining)} stays on the card.` : ''}`
  } else if (checkError) message = checkError

  return (
    <div className="coupon-form gift-card-redeem">
      {appliedCode ? (
        <div className="coupon-form__applied">
          <p className={error ? 'coupon-form__error' : 'coupon-form__success'}>
            <LuGift aria-hidden="true" />
            <span>
              Gift card <strong>•••• {last4}</strong>
              {error ? ` — ${error}` : applied ? ` — pays ${formatBasePrice(applied.applied)}` : checking && ' — checking…'}
              {!error && applied?.remaining !== null && applied?.remaining !== undefined && (
                <span className="coupon-form__hint"> ({formatBasePrice(applied.remaining)} left on the card after this order)</span>
              )}
            </span>
          </p>
          <button type="button" className="coupon-form__remove" onClick={onRemove} disabled={disabled} aria-label={`Remove gift card ending ${last4}`}>
            <LuX aria-hidden="true" />
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <fieldset disabled={disabled || check.isPending} className="coupon-form__fieldset">
            <label htmlFor={inputId}>Gift card</label>
            <div className="coupon-form__row">
              <input
                id={inputId}
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value)
                  if (check.data || check.error) check.reset()
                }}
                placeholder="Gift card code"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={checkError ? true : undefined}
                aria-describedby={[hintId, checkError && errorId].filter(Boolean).join(' ')}
              />
              <Button type="submit" variant="outline" size="sm">
                {check.isPending ? 'Checking…' : 'Apply'}
              </Button>
            </div>
            <p id={hintId} className="coupon-form__hint">
              The 16-character code from your gift card email. One gift card per order.
            </p>
            {checkError && (
              <p id={errorId} className="coupon-form__error">
                {checkError}
              </p>
            )}
          </fieldset>
        </form>
      )}
      {/* Always rendered so screen readers announce the card's result. */}
      <p className="visually-hidden" role="status">
        {message}
      </p>
    </div>
  )
}

export default GiftCardRedeem

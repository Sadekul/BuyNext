import { useId, useState } from 'react'
import { LuCoins, LuX } from 'react-icons/lu'
import Button from '../ui/Button'
import { formatBasePrice } from '../../utils/formatters'
import { formatPoints } from '../../utils/rewards'
import '../cart/CouponForm.css'

/**
 * Phase 11 §4: "Use reward points" at checkout (signed-in customers, when the
 * store has points on). `rewards` is the server's answer for this cart
 * ({ balance, pointValue, minRedeem, maxPoints }); the server checks every
 * limit again and says why points can't be used (`error`). Points pay after
 * tax and before a gift card. Its own <form>, outside the checkout form.
 */
function RewardPointsRedeem({ rewards, appliedPoints, applied, error, onApply, onRemove, disabled = false, checking = false }) {
  const [draft, setDraft] = useState('')
  const [localError, setLocalError] = useState('')
  const inputId = useId()
  const hintId = useId()
  const errorId = useId()

  if (!rewards?.enabled || !(rewards.balance > 0)) return null
  const maxPoints = Math.max(0, Math.min(rewards.maxPoints ?? rewards.balance, rewards.balance))
  const minRedeem = rewards.minRedeem ?? 0
  const worth = rewards.pointValue > 0 ? ` (worth ${formatBasePrice(Math.round(rewards.balance * rewards.pointValue * 100) / 100)})` : ''

  function apply(points) {
    if (!Number.isInteger(points) || points <= 0) {
      setLocalError('Enter a whole number of points.')
      return
    }
    if (points > maxPoints) {
      setLocalError(`You can use up to ${formatPoints(maxPoints)} on this order.`)
      return
    }
    if (minRedeem > 0 && points < minRedeem) {
      setLocalError(`Use at least ${formatPoints(minRedeem)} at a time.`)
      return
    }
    setLocalError('')
    setDraft('')
    onApply(points)
  }

  function handleSubmit(event) {
    event.preventDefault()
    apply(Number(draft.trim()))
  }

  let message = null
  if (appliedPoints > 0 && checking && !applied && !error) message = 'Checking your reward points…'
  else if (appliedPoints > 0 && error) message = `Reward points: ${error}`
  else if (appliedPoints > 0 && applied) message = `${formatPoints(applied.points)} pay ${formatBasePrice(applied.amount)}.`
  else if (localError) message = localError

  return (
    <div className="coupon-form reward-points-redeem">
      {appliedPoints > 0 ? (
        <div className="coupon-form__applied">
          <p className={error ? 'coupon-form__error' : 'coupon-form__success'}>
            <LuCoins aria-hidden="true" />
            <span>
              Reward points <strong>{formatPoints(applied?.points ?? appliedPoints)}</strong>
              {error ? ` — ${error}` : applied ? ` — pay ${formatBasePrice(applied.amount)}` : checking && ' — checking…'}
            </span>
          </p>
          <button type="button" className="coupon-form__remove" onClick={onRemove} disabled={disabled} aria-label="Stop using reward points">
            <LuX aria-hidden="true" />
          </button>
        </div>
      ) : maxPoints <= 0 || (minRedeem > 0 && maxPoints < minRedeem) ? (
        <p className="coupon-form__hint">
          <LuCoins aria-hidden="true" /> You have {formatPoints(rewards.balance)}
          {worth}.{' '}
          {minRedeem > 0 && rewards.balance < minRedeem ? `You can use them once you have ${formatPoints(minRedeem)}.` : "They can't be used on this order."}
        </p>
      ) : (
        // noValidate: our own messages (announced, linked to the field) instead of the browser's bubbles.
        <form onSubmit={handleSubmit} noValidate>
          <fieldset disabled={disabled} className="coupon-form__fieldset">
            <label htmlFor={inputId}>Use reward points</label>
            <div className="coupon-form__row">
              <input
                id={inputId}
                type="number"
                inputMode="numeric"
                min={minRedeem > 0 ? minRedeem : 1}
                max={maxPoints}
                step={1}
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value)
                  setLocalError('')
                }}
                placeholder={String(maxPoints)}
                aria-invalid={localError ? true : undefined}
                aria-describedby={[hintId, localError && errorId].filter(Boolean).join(' ')}
              />
              <Button type="submit" variant="outline" size="sm">
                Apply
              </Button>
              <Button variant="ghost" size="sm" onClick={() => apply(maxPoints)}>
                Use all
              </Button>
            </div>
            <p id={hintId} className="coupon-form__hint">
              You have {formatPoints(rewards.balance)}
              {worth}. Up to {formatPoints(maxPoints)} can be used on this order{minRedeem > 0 ? `, at least ${formatPoints(minRedeem)} at a time` : ''}.
            </p>
            {localError && (
              <p id={errorId} className="coupon-form__error">
                {localError}
              </p>
            )}
          </fieldset>
        </form>
      )}
      {/* Always rendered so screen readers announce the result. */}
      <p className="visually-hidden" role="status">
        {message}
      </p>
    </div>
  )
}

export default RewardPointsRedeem

import { useId, useRef, useState } from 'react'
import { LuGift } from 'react-icons/lu'
import FormField from '../forms/FormField'
import Button from '../ui/Button'
import { formatPrice } from '../../utils/formatters'
import { GIFT_CARD_MESSAGE_MAX, GIFT_CARD_NAME_MAX, customAmountError, withGiftCard } from '../../utils/giftCards'
import { validateEmail } from '../../utils/validation'
import './GiftCardForm.css'

const OTHER = 'other'

/**
 * Buying a gift card (phase 10): choose one of the store's amounts, or type
 * your own within its limits, then say who receives it. The card's code is
 * emailed to the recipient once the order is paid; the buyer gets a copy
 * without the code. `onAdd(purchasable)` adds the line to the cart.
 *
 * Errors appear after the first "Add to cart" and are linked to their fields
 * (aria-describedby); focus moves to the first field to fix.
 */
function GiftCardForm({ product, onAdd }) {
  const id = useId()
  const { amounts, custom } = product.giftCard ?? { amounts: [], custom: null }
  const [values, setValues] = useState(() => ({
    choice: amounts.length > 0 ? String(amounts[Math.min(1, amounts.length - 1)]) : custom ? OTHER : '',
    customAmount: '',
    recipientName: '',
    recipientEmail: '',
    message: '',
  }))
  const [submitted, setSubmitted] = useState(false)
  const [added, setAdded] = useState(null)
  const formRef = useRef(null)

  const isOther = values.choice === OTHER
  const errors = {
    choice: values.choice ? null : 'Choose an amount.',
    customAmount: isOther && custom ? customAmountError(values.customAmount, custom) : null,
    recipientName: values.recipientName.trim() ? null : "Enter the recipient's name.",
    recipientEmail: validateEmail(values.recipientEmail),
  }
  const shown = submitted ? errors : {}
  const amount = isOther ? Number(values.customAmount) : Number(values.choice)

  const change = (field) => (event) => {
    setValues((current) => ({ ...current, [field]: event.target.value }))
    setAdded(null)
  }

  function handleSubmit(event) {
    event.preventDefault()
    setSubmitted(true)
    const firstInvalid = ['choice', 'customAmount', 'recipientName', 'recipientEmail'].find((field) => errors[field])
    if (firstInvalid) {
      formRef.current?.querySelector(`[data-field="${firstInvalid}"]`)?.focus()
      return
    }
    onAdd(withGiftCard(product, { amount, recipientName: values.recipientName, recipientEmail: values.recipientEmail, message: values.message }))
    setAdded(`A ${formatPrice(amount)} gift card for ${values.recipientName.trim()} was added to your cart.`)
    setSubmitted(false)
    setValues((current) => ({ ...current, recipientName: '', recipientEmail: '', message: '' }))
  }

  if (amounts.length === 0 && !custom) {
    return <p className="product-details__stock product-details__stock--out">This gift card isn't available right now.</p>
  }

  const messageHintId = `${id}-message-hint`
  return (
    <form ref={formRef} className="gift-card-form" onSubmit={handleSubmit} noValidate aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="gift-card-form__title">
        <LuGift aria-hidden="true" /> Send this gift card
      </h2>

      <fieldset className="gift-card-form__amounts" aria-describedby={shown.choice ? `${id}-choice-error` : undefined}>
        <legend className="gift-card-form__legend">Amount</legend>
        <div className="gift-card-form__options">
          {amounts.map((value, index) => (
            <label key={value} className="gift-card-form__option">
              <input
                type="radio"
                name={`${id}-amount`}
                value={String(value)}
                checked={values.choice === String(value)}
                onChange={change('choice')}
                data-field={index === 0 ? 'choice' : undefined}
              />
              <span>{formatPrice(value)}</span>
            </label>
          ))}
          {custom && (
            <label className="gift-card-form__option">
              <input type="radio" name={`${id}-amount`} value={OTHER} checked={isOther} onChange={change('choice')} data-field={amounts.length === 0 ? 'choice' : undefined} />
              <span>Other amount</span>
            </label>
          )}
        </div>
        {shown.choice && (
          <p id={`${id}-choice-error`} className="form-field__error">
            {shown.choice}
          </p>
        )}
      </fieldset>

      {isOther && custom && (
        <FormField
          label="Your amount (USD)"
          type="number"
          inputMode="decimal"
          min={custom.min}
          max={custom.max}
          step="0.01"
          value={values.customAmount}
          onChange={change('customAmount')}
          hint={`From ${formatPrice(custom.min)} to ${formatPrice(custom.max)}.`}
          error={shown.customAmount}
          data-field="customAmount"
        />
      )}

      <div className="gift-card-form__grid">
        <FormField
          label="Recipient's name"
          autoComplete="off"
          maxLength={GIFT_CARD_NAME_MAX}
          value={values.recipientName}
          onChange={change('recipientName')}
          error={shown.recipientName}
          data-field="recipientName"
        />
        <FormField
          label="Recipient's email"
          type="email"
          autoComplete="off"
          maxLength={254}
          value={values.recipientEmail}
          onChange={change('recipientEmail')}
          hint="We email the gift card here once your order is paid."
          error={shown.recipientEmail}
          data-field="recipientEmail"
        />
      </div>

      <div className="form-field">
        <label htmlFor={`${id}-message`} className="form-field__label">
          Message (optional)
        </label>
        <textarea
          id={`${id}-message`}
          className="form-field__input gift-card-form__message"
          rows={3}
          maxLength={GIFT_CARD_MESSAGE_MAX}
          value={values.message}
          onChange={change('message')}
          aria-describedby={messageHintId}
        />
        <p id={messageHintId} className="form-field__hint">
          Included in the email to the recipient. Up to {GIFT_CARD_MESSAGE_MAX} characters ({values.message.length} so far).
        </p>
      </div>

      <Button type="submit" size="lg" className="gift-card-form__submit">
        <LuGift aria-hidden="true" /> Add to cart{Number.isFinite(amount) && amount > 0 && !errors.customAmount ? ` · ${formatPrice(amount)}` : ''}
      </Button>
      <p className="gift-card-form__note">Gift cards are delivered by email: no shipping, no tax. They can't be bought with another gift card or a discount code.</p>
      <p className="visually-hidden" role="status">
        {added}
      </p>
    </form>
  )
}

export default GiftCardForm

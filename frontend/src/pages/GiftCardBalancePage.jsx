import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { LuGift } from 'react-icons/lu'
import FormField from '../components/forms/FormField'
import Button from '../components/ui/Button'
import { checkGiftCard } from '../services/shopService'
import { ROUTES } from '../constants/routes'
import { SITE } from '../constants/site'
import { formatDate, formatPrice } from '../utils/formatters'
import { normalizeGiftCardCode } from '../utils/giftCards'
import './OrderPages.css'

const STATUS_TEXT = { expired: 'This gift card has expired.', disabled: "This gift card can't be used." }

/**
 * /gift-cards/balance (REAL_SHOP, phase 10): anyone with a gift card code can
 * see what is left on it. The server answers the same way for unknown and
 * disabled codes (so codes can't be guessed), and limits how often a visitor
 * may ask. The result is announced (role=status), errors as alerts.
 */
function GiftCardBalancePage() {
  const [code, setCode] = useState('')
  const [touched, setTouched] = useState(false)
  const check = useMutation({ mutationFn: (value) => checkGiftCard(value) })
  const normalized = normalizeGiftCardCode(code)
  const fieldError = touched && normalized.length < 4 ? 'Enter the gift card code from your email.' : null
  const card = check.data
  const requestError = check.error ? (check.error.status === 429 ? 'Too many tries. Please wait a minute and try again.' : (check.error.fieldErrors?.code?.[0] ?? check.error.message)) : null

  function handleSubmit(event) {
    event.preventDefault()
    setTouched(true)
    if (normalized.length < 4) {
      event.currentTarget.elements.code.focus()
      return
    }
    check.mutate(normalized)
  }

  let result = null
  if (card) {
    result =
      card.status === 'active'
        ? `Balance: ${formatPrice(card.balance)}.${card.expiresAt ? ` Use it by ${formatDate(card.expiresAt)}.` : ' It never expires.'}`
        : (STATUS_TEXT[card.status] ?? STATUS_TEXT.disabled)
  }

  return (
    <div className="track-order section container">
      <title>{`Check gift card balance | ${SITE.name}`}</title>
      <header>
        <h1>Check gift card balance</h1>
        <p>Enter the code from your gift card email to see what's left on it. Use the card at checkout: it pays as much of your order as its balance covers.</p>
      </header>

      <form className="track-order__form" onSubmit={handleSubmit} noValidate>
        <FormField
          label="Gift card code"
          name="code"
          autoComplete="off"
          spellCheck={false}
          value={code}
          onChange={(event) => {
            setCode(event.target.value)
            if (check.data || check.error) check.reset()
          }}
          hint="16 letters and numbers. Spaces and dashes are fine."
          error={fieldError}
        />
        {requestError && (
          <p className="track-order__error" role="alert">
            {requestError}
          </p>
        )}
        <Button type="submit" disabled={check.isPending}>
          <LuGift aria-hidden="true" /> {check.isPending ? 'Checking…' : 'Check balance'}
        </Button>
      </form>

      {/* Always in the page, so the answer is read out when it arrives. */}
      <div role="status" className={result ? 'gift-card-balance' : undefined}>
        {result && (
          <>
            <p className="gift-card-balance__amount">{result}</p>
            {card.status === 'active' && card.balance > 0 && (
              <Button to={ROUTES.products} variant="outline" size="sm">
                Start shopping
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default GiftCardBalancePage

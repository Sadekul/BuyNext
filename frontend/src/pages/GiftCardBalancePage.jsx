import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { LuGift } from 'react-icons/lu'
import FormField from '../components/forms/FormField'
import Button from '../components/ui/Button'
import { checkGiftCard } from '../services/shopService'
import { ROUTES } from '../constants/routes'
import { SITE } from '../constants/site'
import { formatDate, formatBasePrice } from '../utils/formatters'
import { normalizeGiftCardCode } from '../utils/giftCards'
import './OrderPages.css'
import { useTranslation } from 'react-i18next'

const STATUS_KEYS = { expired: 'balance.expired', disabled: 'balance.disabled' }

/**
 * /gift-cards/balance (REAL_SHOP, phase 10): anyone with a gift card code can
 * see what is left on it. The server answers the same way for unknown and
 * disabled codes (so codes can't be guessed), and limits how often a visitor
 * may ask. The result is announced (role=status), errors as alerts.
 */
function GiftCardBalancePage() {
  const { t } = useTranslation('checkout')
  const [code, setCode] = useState('')
  const [touched, setTouched] = useState(false)
  const check = useMutation({ mutationFn: (value) => checkGiftCard(value) })
  const normalized = normalizeGiftCardCode(code)
  const fieldError = touched && normalized.length < 4 ? t('balance.codeRequired') : null
  const card = check.data
  const requestError = check.error ? (check.error.status === 429 ? t('balance.tooMany') : (check.error.fieldErrors?.code?.[0] ?? check.error.message)) : null

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
        ? `${t('balance.result', { amount: formatBasePrice(card.balance, card.currency) })} ${card.expiresAt ? t('balance.useBy', { date: formatDate(card.expiresAt) }) : t('balance.never')}`
        : t(STATUS_KEYS[card.status] ?? STATUS_KEYS.disabled)
  }

  return (
    <div className="track-order section container">
      <title>{`${t('balance.title')} | ${SITE.name}`}</title>
      <header>
        <h1>{t('balance.title')}</h1>
        <p>{t('balance.intro')}</p>
      </header>

      <form className="track-order__form" onSubmit={handleSubmit} noValidate>
        <FormField
          label={t('balance.code')}
          name="code"
          autoComplete="off"
          spellCheck={false}
          value={code}
          onChange={(event) => {
            setCode(event.target.value)
            if (check.data || check.error) check.reset()
          }}
          hint={t('balance.hint')}
          error={fieldError}
        />
        {requestError && (
          <p className="track-order__error" role="alert">
            {requestError}
          </p>
        )}
        <Button type="submit" disabled={check.isPending}>
          <LuGift aria-hidden="true" /> {t(check.isPending ? 'balance.checking' : 'balance.check')}
        </Button>
      </form>

      {/* Always in the page, so the answer is read out when it arrives. */}
      <div role="status" className={result ? 'gift-card-balance' : undefined}>
        {result && (
          <>
            <p className="gift-card-balance__amount">{result}</p>
            {card.status === 'active' && card.balance > 0 && (
              <Button to={ROUTES.products} variant="outline" size="sm">
                {t('balance.startShopping')}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default GiftCardBalancePage

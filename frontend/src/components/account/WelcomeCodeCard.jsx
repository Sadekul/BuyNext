import { useId, useRef, useState } from 'react'
import { LuCircleCheck, LuClock, LuCopy, LuTicket } from 'react-icons/lu'
import { useTranslation } from 'react-i18next'
import Button from '../ui/Button'
import { formatDate } from '../../utils/formatters'
import { minimumLine } from '../../utils/welcomeOffer'
import { localizeDigits } from '../../i18n/intl'
import './WelcomeCodeCard.css'

const STATUS_ICONS = { active: LuTicket, used: LuCircleCheck, expired: LuClock }

/** "2026-12-26T23:59:59+06:00" → a localised date, or null when there is none (or it can't be read). */
function dateOf(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : formatDate(value)
}

/**
 * Phase 19 (PHASE19_CONTRACT.md §3): the signed-in customer's personal
 * welcome code on the account overview (GET /me `welcome_coupon`, as
 * normalizeUser keeps it: { code, label, minSubtotal, expiresAt, status, firstOrderOnly? }).
 * Nothing is rendered without one. The status is written in words with its
 * own icon (colour is never the only signal); the Copy result is announced in
 * a status message, and without clipboard access the code is selected so it
 * can be copied by hand.
 */
function WelcomeCodeCard({ coupon }) {
  const { t } = useTranslation('marketing')
  const titleId = useId()
  const codeRef = useRef(null)
  const [copyStatus, setCopyStatus] = useState('')
  if (!coupon?.code) return null

  const { code, status } = coupon
  const StatusIcon = STATUS_ICONS[status] ?? LuTicket
  const date = dateOf(coupon.expiresAt)
  const minimum = minimumLine(coupon.minSubtotal, t)

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopyStatus(t('welcome.copied', { code }))
    } catch {
      const selection = window.getSelection?.()
      if (selection && codeRef.current) selection.selectAllChildren(codeRef.current)
      setCopyStatus(t('welcome.copyFailed'))
    }
  }

  return (
    <section className={`welcome-code welcome-code--${status}`} aria-labelledby={titleId}>
      <div className="welcome-code__head">
        <h2 id={titleId} className="welcome-code__title">
          <LuTicket className="welcome-code__icon" aria-hidden="true" />
          {t('welcome.cardTitle')}
        </h2>
        <p className="welcome-code__status">
          <span className="visually-hidden">{t('welcome.statusLabel')} </span>
          <StatusIcon aria-hidden="true" />
          {t(`welcome.status.${status}`)}
        </p>
      </div>

      {coupon.label && (
        <p className="welcome-code__offer">
          {coupon.firstOrderOnly ? t('welcome.offerFirstOrder', { offer: localizeDigits(coupon.label) }) : localizeDigits(coupon.label)}
        </p>
      )}
      {minimum && <p className="welcome-code__meta">{minimum}</p>}

      <div className="welcome-code__row">
        <p className="welcome-code__box">
          <span className="welcome-code__label">{t('welcome.codeLabel')}</span>
          <code ref={codeRef} className="welcome-code__code">
            {code}
          </code>
        </p>
        {status === 'active' && (
          <Button size="sm" variant="outline" onClick={copy} aria-label={t('welcome.copyLabel', { code })}>
            <LuCopy aria-hidden="true" />
            {t('welcome.copy')}
          </Button>
        )}
      </div>
      {status === 'active' && (
        <p role="status" className="welcome-code__copy-status">
          {copyStatus}
        </p>
      )}

      {date && status === 'active' && <p className="welcome-code__meta">{t('welcome.useBy', { date })}</p>}
      {date && status === 'expired' && <p className="welcome-code__meta">{t('welcome.expiredOn', { date })}</p>}
      {status === 'active' && <p className="welcome-code__meta">{t('welcome.useAtCheckout')}</p>}
    </section>
  )
}

export default WelcomeCodeCard

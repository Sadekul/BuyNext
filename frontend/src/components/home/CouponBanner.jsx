import { useId, useRef, useState } from 'react'
import { LuCopy, LuTicket } from 'react-icons/lu'
import { useTranslation } from 'react-i18next'
import Button from '../ui/Button'
import './CouponBanner.css'

/**
 * Coupon banner (phase 17, PHASE17_CONTRACT.md §4.7): shown only when the
 * admin's top promo strip names a coupon, which the API sends only while that
 * coupon exists and is active (GET /home `top_bar.coupon_code`). The heading
 * is the admin's own message; the code has a Copy button whose result is
 * announced in a status message. Without clipboard access the code is
 * selected instead, so it can be copied by hand. No expiry or countdown is
 * shown: the API gives none.
 *
 * `topBar`: `{ message, couponCode }` (services/adapters/contentAdapter.js normalizeTopBar) or null.
 */
function CouponBanner({ topBar }) {
  const { t } = useTranslation('marketing')
  const headingId = useId()
  const codeRef = useRef(null)
  const [status, setStatus] = useState('')
  const code = topBar?.couponCode
  if (!code) return null

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setStatus(t('home.coupon.copied', { code }))
    } catch {
      const selection = window.getSelection?.()
      if (selection && codeRef.current) selection.selectAllChildren(codeRef.current)
      setStatus(t('home.coupon.copyFailed'))
    }
  }

  return (
    <section className="section home-section coupon-band" aria-labelledby={headingId}>
      <div className="container">
        <div className="coupon-band__panel">
          <span className="coupon-band__icon" aria-hidden="true">
            <LuTicket />
          </span>
          <div className="coupon-band__copy">
            <p className="coupon-band__eyebrow">{t('home.coupon.eyebrow')}</p>
            <h2 id={headingId} className="coupon-band__title">
              {topBar.message}
            </h2>
            <p className="coupon-band__hint">{t('home.coupon.hint')}</p>
          </div>
          <div className="coupon-band__actions">
            <p className="coupon-band__code-box">
              <span className="coupon-band__code-label">{t('home.coupon.codeLabel')}</span>
              <code ref={codeRef} className="coupon-band__code">
                {code}
              </code>
            </p>
            <Button size="sm" onClick={copy} className="coupon-band__copy-button" aria-label={t('home.coupon.copyLabel', { code })}>
              <LuCopy aria-hidden="true" />
              {t('home.coupon.copy')}
            </Button>
            <p role="status" className="coupon-band__status">
              {status}
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

export default CouponBanner

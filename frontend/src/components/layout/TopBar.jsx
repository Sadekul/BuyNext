import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { LuCopy, LuSparkles, LuTruck, LuX } from 'react-icons/lu'
import CurrencyPicker from './CurrencyPicker'
import LanguageSwitch from './LanguageSwitch'
import { REAL_SHOP } from '../../constants/shop'
import { STORAGE_KEYS } from '../../constants/storageKeys'
import { storeAnnouncements } from '../../constants/site'
import { homeContentQuery } from '../../queries/contentQueries'
import { deliveryEstimateQuery } from '../../queries/placesQueries'
import { useStoreSettings } from '../../hooks/useStoreSettings'
import { etaText } from '../../utils/bangladesh'
import { deliverToPlace, useDeliverTo } from '../../utils/deliverTo'
import { formatBasePrice } from '../../utils/formatters'
import { cn } from '../../utils/classNames'
import './TopBar.css'

// The closed promo message is remembered per browser; storage may be unavailable (private mode).
function readDismissed() {
  try {
    return window.localStorage.getItem(STORAGE_KEYS.announcement)
  } catch {
    return null
  }
}

function saveDismissed(message) {
  try {
    window.localStorage.setItem(STORAGE_KEYS.announcement, message)
  } catch {
    // Not remembered: it shows again on the next visit.
  }
}

/** The delivery method the line names: standard delivery when offered, else the first. */
const lineMethod = (methods = []) => methods.find((method) => method.id === 'standard') ?? methods[0] ?? null

/**
 * Phase 17 top bar (replaces the redesign's announcement bar), the first row of
 * the header:
 * - delivery line: "Deliver to: Banani, Dhaka · Delivery in 1–2 days" once a
 *   "Deliver to" area is chosen (Bangladesh stores), otherwise the store's
 *   free-delivery line;
 * - the admin's promo message (GET /home `top_bar`) with its coupon code, only
 *   when the API says the coupon is active, a "Copy" button and a status
 *   message; the shopper can close the promo (remembered per browser; a new
 *   message shows again);
 * - language switch and the display-currency picker.
 * `compact` (the checkout) keeps only the language and currency.
 * On phones the bar shows one item: the promo when there is one, else the delivery line.
 */
function TopBar({ compact = false }) {
  const { t } = useTranslation('common')
  const { settings } = useStoreSettings()
  const choice = useDeliverTo()
  const bangladesh = settings.bangladeshAddresses === true
  const home = useQuery({ ...homeContentQuery(), enabled: REAL_SHOP && !compact })
  const estimate = useQuery({ ...deliveryEstimateQuery(choice?.areaId), enabled: REAL_SHOP && bangladesh && !compact && Boolean(choice) })
  const [dismissed, setDismissed] = useState(readDismissed)

  const promo = home.data?.topBar ?? null
  const showPromo = Boolean(promo) && dismissed !== promo.message

  let deliveryLine
  if (bangladesh && choice) {
    const method = lineMethod(estimate.data?.methods)
    const eta = method ? (etaText(method) ?? method.eta) : ''
    deliveryLine = eta ? t('topBar.deliverToEta', { place: deliverToPlace(choice), eta }) : t('topBar.deliverTo', { place: deliverToPlace(choice) })
  } else {
    deliveryLine = storeAnnouncements(settings.freeShippingThreshold, formatBasePrice)[0] ?? null
  }

  function dismiss() {
    saveDismissed(promo.message)
    setDismissed(promo.message)
  }

  const hasMessages = !compact && (deliveryLine || showPromo)

  return (
    <div className={cn('top-bar', compact && 'top-bar--compact')}>
      <div className="top-bar__inner container">
        {hasMessages && (
          <aside className={cn('top-bar__messages', showPromo && 'top-bar__messages--promo')} aria-label={t('announcements.label')}>
            {deliveryLine && (
              <p className="top-bar__delivery">
                <LuTruck aria-hidden="true" className="top-bar__icon" />
                <span>{deliveryLine}</span>
              </p>
            )}
            {showPromo && (
              <div className="top-bar__promo">
                <LuSparkles aria-hidden="true" className="top-bar__icon top-bar__icon--promo" />
                <p className="top-bar__promo-text">{promo.message}</p>
                {promo.couponCode && <CouponCode code={promo.couponCode} />}
                <button type="button" className="top-bar__close" onClick={dismiss} aria-label={t('announcements.dismiss')}>
                  <LuX aria-hidden="true" />
                </button>
              </div>
            )}
          </aside>
        )}
        <div className="top-bar__settings">
          {/* Phase 11: "show prices in" another currency, when the store offers one. */}
          <CurrencyPicker />
          {/* Phase 13: বাংলা / English. */}
          <LanguageSwitch className="language-switch--footer top-bar__language" />
        </div>
      </div>
    </div>
  )
}

/** "Code NEST10 [Copy]" with a polite status message after copying. */
export function CouponCode({ code, className }) {
  const { t } = useTranslation('common')
  const [status, setStatus] = useState('')
  const timer = useRef(null)

  useEffect(() => () => clearTimeout(timer.current), [])

  async function copy() {
    let copied
    try {
      await navigator.clipboard.writeText(code)
      copied = true
    } catch {
      copied = false
    }
    setStatus(copied ? t('topBar.copied', { code }) : t('topBar.copyFailed', { code }))
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setStatus(''), 5000)
  }

  return (
    <span className={cn('coupon-code', className)}>
      <span className="coupon-code__label">{t('topBar.code')}</span>
      <code className="coupon-code__value" lang="en">
        {code}
      </code>
      <button type="button" className="coupon-code__copy" onClick={copy} aria-label={t('topBar.copyCode', { code })}>
        <LuCopy aria-hidden="true" />
        <span aria-hidden="true">{t('topBar.copy')}</span>
      </button>
      <span className="coupon-code__status" role="status">
        {status}
      </span>
    </span>
  )
}

export default TopBar

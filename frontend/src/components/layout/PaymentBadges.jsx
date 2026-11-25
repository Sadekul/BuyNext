import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { LuBanknote, LuCreditCard, LuSmartphone, LuWallet } from 'react-icons/lu'
import { paymentBadgeIds } from '../../utils/payment'
import './PaymentBadges.css'

// Our own simple text badges with a generic icon: no payment brand's logo is copied or loaded.
const BADGES = {
  card: LuCreditCard,
  paypal: LuWallet,
  cod: LuBanknote,
  bkash: LuSmartphone,
  nagad: LuSmartphone,
}

/** "We accept" with one badge per way to pay (nothing when the store offers none). */
function PaymentBadges({ paymentMethods }) {
  const { t } = useTranslation('common')
  const badges = paymentBadgeIds(paymentMethods)
  const titleId = useId()
  if (badges.length === 0) return null
  return (
    <div className="payment-badges">
      <h2 className="payment-badges__title" id={titleId}>
        {t('footer.payments')}
      </h2>
      <ul className="payment-badges__list" aria-labelledby={titleId}>
        {badges.map((id) => {
          const Icon = BADGES[id]
          return (
            <li key={id} className={`payment-badge payment-badge--${id}`}>
              <Icon aria-hidden="true" className="payment-badge__icon" />
              {t(`footer.paymentBadges.${id}`)}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default PaymentBadges

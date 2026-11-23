import CouponForm from './CouponForm'
import DiscountRows from './DiscountRows'
import FreeShippingProgress from './FreeShippingProgress'
import ChargedInBaseNote from './ChargedInBaseNote'
import { formatPrice } from '../../utils/formatters'
import './CartSummary.css'
import { useTranslation } from 'react-i18next'

/**
 * Order summary. Every number comes from calculateCartTotals();
 * this component only displays them. `children` holds the action buttons.
 */
function CartSummary({ totals, couponCode, onApplyCoupon, onRemoveCoupon, isCheckingCoupon = false, showTax = true, children }) {
  const { t } = useTranslation('cart')
  return (
    <section className="cart-summary" aria-labelledby="cart-summary-title">
      <h2 id="cart-summary-title" className="cart-summary__title">
        {t('summary.title')}
      </h2>

      <FreeShippingProgress amountRemaining={totals.amountToFreeShipping} threshold={totals.freeShippingThreshold} />

      <dl className="cart-summary__rows">
        <div>
          <dt>{t('summary.subtotal', { count: totals.itemCount })}</dt>
          <dd>{formatPrice(totals.subtotal)}</dd>
        </div>
        {totals.productSavings > 0 && (
          <div className="cart-summary__saving">
            <dt>{t('summary.productSavings')}</dt>
            <dd>{formatPrice(totals.productSavings)}</dd>
          </div>
        )}
        <DiscountRows rules={totals.appliedRules} discount={totals.discount} couponCode={couponCode} />
        <div>
          <dt>{t('summary.estimatedShipping')}</dt>
          {/* Phase 10: gift cards only: they're emailed. */}
          <dd>{totals.requiresShipping === false ? t('summary.noShipping') : totals.shipping === 0 ? t('summary.free') : formatPrice(totals.shipping)}</dd>
        </div>
        {/* A store that charges no tax (REAL_SHOP settings) shows no tax line. */}
        {showTax && (
          <div>
            <dt>{t('summary.taxes')}</dt>
            <dd>{t('summary.taxesLater')}</dd>
          </div>
        )}
        <div className="cart-summary__total">
          <dt>{t('summary.estimatedTotal')}</dt>
          <dd>{formatPrice(totals.total)}</dd>
        </div>
      </dl>
      {/* Phase 11: prices shown in another currency are approximate; the order is charged in the store currency. */}
      <ChargedInBaseNote amount={totals.total} />

      <CouponForm
        appliedCode={couponCode}
        coupon={totals.coupon}
        couponError={totals.couponError}
        onApply={onApplyCoupon}
        onRemove={onRemoveCoupon}
        checking={isCheckingCoupon}
      />

      {children && <div className="cart-summary__actions">{children}</div>}

      <p className="cart-summary__note">
        {t('summary.note')}
      </p>
    </section>
  )
}

export default CartSummary

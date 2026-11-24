import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LuShoppingBag } from 'react-icons/lu'
import CartLineItem from '../components/cart/CartLineItem'
import CartSummary from '../components/cart/CartSummary'
import GroupDiscountNote from '../components/cart/GroupDiscountNote'
import ProductGrid from '../components/product/ProductGrid'
import { useAuth } from '../hooks/useAuth'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import { useCart } from '../hooks/useCart'
import { useProductRefresh } from '../hooks/useProductRefresh'
import { ROUTES } from '../constants/routes'
import { SITE } from '../constants/site'
import { REAL_SHOP } from '../constants/shop'
import { cartPricingQuery } from '../queries/orderQueries'
import { defaultShippingMethodId, useStoreSettings } from '../hooks/useStoreSettings'
import { withServerPricing } from '../utils/cartTotals'
import { cartLineKey } from '../reducers/cartReducer'
import './CartPage.css'
import { isBangladesh } from '../utils/bangladesh'
import { useTranslation } from 'react-i18next'

function CartPage() {
  const { t } = useTranslation('cart')
  const cart = useCart()
  const { user } = useAuth()
  // Re-check prices and stock once each time the cart page opens.
  const refresh = useProductRefresh({ hasItems: cart.items.length > 0, onProducts: cart.refreshProducts })
  // REAL_SHOP: the server prices the cart and decides whether the coupon applies
  // (same request and cache entry as the checkout's standard delivery).
  const { settings } = useStoreSettings()
  const pricing = useQuery({
    // A cart of gift cards only (phase 10) has no delivery method.
    ...cartPricingQuery({ items: cart.items, couponCode: cart.couponCode, shippingMethod: cart.totals.requiresShipping ? defaultShippingMethodId(settings) : null }),
    enabled: REAL_SHOP && cart.items.length > 0,
  })
  const totals = REAL_SHOP ? withServerPricing(cart.totals, pricing.data) : cart.totals
  const problems = REAL_SHOP ? (pricing.data?.problems ?? []) : []
  const { unavailableCount, canCheckout } = cart.totals
  const changedCount = cart.items.filter((item) => item.notice).length
  // The server's line for each item (its prices include a customer group's discount).
  const pricedLine = (item) => pricing.data?.lines.find((line) => cartLineKey(line) === cartLineKey(item))
  // Phase 11: "Customers also bought" (the admin's cross-sells for these products; none in the demo).
  const crossSells = REAL_SHOP ? (pricing.data?.crossSells ?? []) : []
  const { addItem } = cart
  const handleAddToCart = useCallback((product) => addItem(product), [addItem])

  if (cart.items.length === 0) {
    return (
      <div className="section container">
        <title>{`${t('page.tabTitle')} | ${SITE.name}`}</title>
        <EmptyState icon={LuShoppingBag} title={t('page.emptyTitle')} message={t('page.emptyMessage')}>
          <Button to={ROUTES.products}>{t('page.startShopping')}</Button>
        </EmptyState>
      </div>
    )
  }

  return (
    <div className="cart-page section container">
      <title>{`${t('page.tabTitleCount', { count: cart.totals.itemCount })} | ${SITE.name}`}</title>
      <header className="cart-page__header">
        <h1>{t('page.title')}</h1>
        <p className="cart-page__status" role="status">
          {/* This live region is always rendered, so screen readers announce its changes. */}
          {refresh.isFetching && t('page.checking')}
          {!refresh.isFetching && !refresh.error && changedCount > 0 && t('page.changed', { count: changedCount })}
          {refresh.error && (
            <>
              {t('page.checkFailed', { reason: refresh.error.message })}{' '}
              <button type="button" className="cart-page__link-button" onClick={() => refresh.refetch()}>
                {t('page.tryAgain')}
              </button>
            </>
          )}
        </p>
      </header>

      <div className="cart-page__layout">
        <section aria-labelledby="cart-items-title">
          <h2 id="cart-items-title" className="visually-hidden">
            {t('page.items')}
          </h2>
          <ul className="cart-page__list">
            {cart.items.map((item) => (
              <li key={cartLineKey(item)}>
                <CartLineItem item={item} pricedLine={REAL_SHOP ? pricedLine(item) : undefined} onQuantityChange={cart.updateQuantity} onRemove={cart.removeItem} />
              </li>
            ))}
          </ul>
          <div className="cart-page__list-actions">
            <Button to={ROUTES.products} variant="ghost">
              {t('page.continue')}
            </Button>
            <Button variant="ghost" onClick={cart.clearCart}>
              {t('page.clear')}
            </Button>
          </div>
        </section>

        <CartSummary
          totals={totals}
          couponCode={cart.couponCode}
          onApplyCoupon={cart.applyCoupon}
          onRemoveCoupon={cart.removeCoupon}
          isCheckingCoupon={REAL_SHOP && pricing.isFetching}
          showTax={!REAL_SHOP || settings.taxEnabled}
          // Phase 14: a Bangladeshi store prices delivery by the shopper's area, chosen at checkout.
          areaNote={REAL_SHOP && settings.bangladeshAddresses === true && isBangladesh(settings.defaultCountry)}
        >
          {REAL_SHOP && <GroupDiscountNote group={pricing.data?.customerGroup ?? user?.group} amount={pricing.data?.totals.groupDiscount} />}
          {problems.length > 0 && (
            <p className="cart-page__blocker" role="alert">
              {problems.map((problem) => problem.message).join(' ')}
            </p>
          )}
          {REAL_SHOP && pricing.error && !pricing.data && (
            <p className="cart-page__blocker" role="alert">
              {t('page.pricesFailed', { reason: pricing.error.message })}
            </p>
          )}
          {unavailableCount > 0 && (
            <p className="cart-page__blocker" role="alert">
              {t('page.removeUnavailable', { count: unavailableCount })}
            </p>
          )}
          {!canCheckout ? (
            <Button size="lg" fullWidth disabled>
              {t('page.proceed')}
            </Button>
          ) : (
            <Button to={ROUTES.checkout} size="lg" fullWidth>
              {t('page.proceed')}
            </Button>
          )}
        </CartSummary>
      </div>

      {crossSells.length > 0 && (
        <section className="cart-page__cross-sells" aria-labelledby="cross-sells-title">
          <h2 id="cross-sells-title">{t('page.crossSells')}</h2>
          <ProductGrid products={crossSells} onAddToCart={handleAddToCart} />
        </section>
      )}
    </div>
  )
}

export default CartPage

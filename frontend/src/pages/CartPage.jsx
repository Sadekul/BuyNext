import { useQuery } from '@tanstack/react-query'
import { LuShoppingBag } from 'react-icons/lu'
import CartLineItem from '../components/cart/CartLineItem'
import CartSummary from '../components/cart/CartSummary'
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
import './CartPage.css'

function CartPage() {
  const cart = useCart()
  // Re-check prices and stock once each time the cart page opens.
  const refresh = useProductRefresh({ hasItems: cart.items.length > 0, onProducts: cart.refreshProducts })
  // REAL_SHOP: the server prices the cart and decides whether the coupon applies
  // (same request and cache entry as the checkout's standard delivery).
  const { settings } = useStoreSettings()
  const pricing = useQuery({
    ...cartPricingQuery({ items: cart.items, couponCode: cart.couponCode, shippingMethod: defaultShippingMethodId(settings) }),
    enabled: REAL_SHOP && cart.items.length > 0,
  })
  const totals = REAL_SHOP ? withServerPricing(cart.totals, pricing.data) : cart.totals
  const problems = REAL_SHOP ? (pricing.data?.problems ?? []) : []
  const { unavailableCount, canCheckout } = cart.totals
  const changedCount = cart.items.filter((item) => item.notice).length

  if (cart.items.length === 0) {
    return (
      <div className="section container">
        <title>{`Cart | ${SITE.name}`}</title>
        <EmptyState icon={LuShoppingBag} title="Your cart is empty" message="Browse the catalog and add something you love.">
          <Button to={ROUTES.products}>Start shopping</Button>
        </EmptyState>
      </div>
    )
  }

  return (
    <div className="cart-page section container">
      <title>{`Cart (${cart.totals.itemCount}) | ${SITE.name}`}</title>
      <header className="cart-page__header">
        <h1>Shopping cart</h1>
        <p className="cart-page__status" role="status">
          {/* This live region is always rendered, so screen readers announce its changes. */}
          {refresh.isFetching && 'Checking the latest prices and stock…'}
          {!refresh.isFetching && !refresh.error && changedCount > 0 &&
            `${changedCount} ${changedCount === 1 ? 'item has' : 'items have'} changed since you added ${changedCount === 1 ? 'it' : 'them'}. See the notes below.`}
          {refresh.error && (
            <>
              We couldn't check the latest prices ({refresh.error.message}){' '}
              <button type="button" className="cart-page__link-button" onClick={() => refresh.refetch()}>
                Try again
              </button>
            </>
          )}
        </p>
      </header>

      <div className="cart-page__layout">
        <section aria-labelledby="cart-items-title">
          <h2 id="cart-items-title" className="visually-hidden">
            Items in your cart
          </h2>
          <ul className="cart-page__list">
            {cart.items.map((item) => (
              <li key={item.productId}>
                <CartLineItem item={item} onQuantityChange={cart.updateQuantity} onRemove={cart.removeItem} />
              </li>
            ))}
          </ul>
          <div className="cart-page__list-actions">
            <Button to={ROUTES.products} variant="ghost">
              Continue shopping
            </Button>
            <Button variant="ghost" onClick={cart.clearCart}>
              Clear cart
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
        >
          {problems.length > 0 && (
            <p className="cart-page__blocker" role="alert">
              {problems.map((problem) => problem.message).join(' ')}
            </p>
          )}
          {REAL_SHOP && pricing.error && !pricing.data && (
            <p className="cart-page__blocker" role="alert">
              We couldn't check the prices ({pricing.error.message}). The total is confirmed at checkout.
            </p>
          )}
          {unavailableCount > 0 && (
            <p className="cart-page__blocker" role="alert">
              Remove {unavailableCount === 1 ? 'the unavailable item' : `${unavailableCount} unavailable items`} to
              continue.
            </p>
          )}
          {!canCheckout ? (
            <Button size="lg" fullWidth disabled>
              Proceed to checkout
            </Button>
          ) : (
            <Button to={ROUTES.checkout} size="lg" fullWidth>
              Proceed to checkout
            </Button>
          )}
        </CartSummary>
      </div>
    </div>
  )
}

export default CartPage

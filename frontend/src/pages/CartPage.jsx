import { LuShoppingBag } from 'react-icons/lu'
import CartLineItem from '../components/cart/CartLineItem'
import CartSummary from '../components/cart/CartSummary'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import { useCart } from '../hooks/useCart'
import { useProductRefresh } from '../hooks/useProductRefresh'
import { ROUTES } from '../constants/routes'
import { SITE } from '../constants/site'
import './CartPage.css'

function CartPage() {
  const cart = useCart()
  // Re-check prices and stock once each time the cart page opens.
  const refresh = useProductRefresh('cart', { hasItems: cart.items.length > 0, onProducts: cart.refreshProducts })
  const unavailableCount = cart.items.filter((item) => item.isUnavailable).length

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
          {refresh.isLoading && 'Checking the latest prices and stock…'}
          {refresh.error && (
            <>
              We couldn't check the latest prices ({refresh.error.message}){' '}
              <button type="button" className="cart-page__link-button" onClick={refresh.retry}>
                Try again
              </button>
            </>
          )}
        </p>
      </header>

      <div className="cart-page__layout">
        <section aria-label="Cart items">
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
          totals={cart.totals}
          couponCode={cart.couponCode}
          onApplyCoupon={cart.applyCoupon}
          onRemoveCoupon={cart.removeCoupon}
        >
          {unavailableCount > 0 && (
            <p className="cart-page__blocker" role="alert">
              Remove {unavailableCount === 1 ? 'the unavailable item' : `${unavailableCount} unavailable items`} to
              continue.
            </p>
          )}
          {unavailableCount > 0 ? (
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

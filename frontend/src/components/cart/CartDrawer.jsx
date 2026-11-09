import { LuShoppingBag } from 'react-icons/lu'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import EmptyState from '../ui/EmptyState'
import CartLineItem from './CartLineItem'
import FreeShippingProgress from './FreeShippingProgress'
import { useCart } from '../../hooks/useCart'
import { ROUTES } from '../../constants/routes'
import { formatPrice } from '../../utils/formatters'
import './CartDrawer.css'

/** Slide-out mini cart. Opens automatically when an item is added. */
function CartDrawer() {
  const { items, totals, isCartOpen, closeCart, updateQuantity, removeItem } = useCart()

  const footer = items.length > 0 && (
    <div className="cart-drawer__footer">
      <p className="cart-drawer__subtotal">
        <span>Subtotal</span>
        <strong>{formatPrice(totals.subtotal)}</strong>
      </p>
      <Button to={ROUTES.checkout} onClick={closeCart} fullWidth>
        Checkout
      </Button>
      <Button to={ROUTES.cart} onClick={closeCart} variant="outline" fullWidth>
        View cart
      </Button>
    </div>
  )

  return (
    <Modal
      isOpen={isCartOpen}
      onClose={closeCart}
      title={`Your cart (${totals.itemCount})`}
      variant="drawer-right"
      footer={footer}
    >
      {items.length === 0 ? (
        <EmptyState icon={LuShoppingBag} titleAs="h3" title="Your cart is empty" message="Add a few favorites to get started.">
          <Button to={ROUTES.products} onClick={closeCart}>
            Start shopping
          </Button>
        </EmptyState>
      ) : (
        <div className="cart-drawer">
          <FreeShippingProgress amountRemaining={totals.amountToFreeShipping} />
          <ul className="cart-drawer__list">
            {items.map((item) => (
              <li key={item.productId}>
                <CartLineItem
                  item={item}
                  compact
                  onQuantityChange={updateQuantity}
                  onRemove={removeItem}
                  onNavigate={closeCart}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  )
}

export default CartDrawer

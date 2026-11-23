import { LuShoppingBag } from 'react-icons/lu'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import EmptyState from '../ui/EmptyState'
import CartLineItem from './CartLineItem'
import FreeShippingProgress from './FreeShippingProgress'
import ChargedInBaseNote from './ChargedInBaseNote'
import { useCart } from '../../hooks/useCart'
import { ROUTES } from '../../constants/routes'
import { formatPrice } from '../../utils/formatters'
import { cartLineKey } from '../../reducers/cartReducer'
import './CartDrawer.css'
import { useTranslation } from 'react-i18next'

/** Slide-out mini cart. Opens automatically when an item is added. */
function CartDrawer() {
  const { t } = useTranslation('cart')
  const { items, totals, isCartOpen, closeCart, updateQuantity, removeItem } = useCart()

  const footer = items.length > 0 && (
    <div className="cart-drawer__footer">
      <p className="cart-drawer__subtotal">
        <span>{t('drawer.subtotal')}</span>
        <strong>{formatPrice(totals.subtotal)}</strong>
      </p>
      <ChargedInBaseNote className="cart-drawer__note" />
      {totals.unavailableCount > 0 && (
        <p className="cart-drawer__blocker">{t('drawer.blocker')}</p>
      )}
      {/* Same rule as the cart page: no checkout while unavailable items remain. */}
      {totals.canCheckout ? (
        <Button to={ROUTES.checkout} onClick={closeCart} fullWidth>
          {t('drawer.checkout')}
        </Button>
      ) : (
        <Button fullWidth disabled>
          {t('drawer.checkout')}
        </Button>
      )}
      <Button to={ROUTES.cart} onClick={closeCart} variant="outline" fullWidth>
        {t('drawer.viewCart')}
      </Button>
    </div>
  )

  return (
    <Modal
      isOpen={isCartOpen}
      onClose={closeCart}
      title={t('drawer.title', { count: totals.totalQuantity })}
      variant="drawer-right"
      footer={footer}
    >
      {items.length === 0 ? (
        <EmptyState icon={LuShoppingBag} titleAs="h3" title={t('drawer.emptyTitle')} message={t('drawer.emptyMessage')}>
          <Button to={ROUTES.products} onClick={closeCart}>
            {t('drawer.startShopping')}
          </Button>
        </EmptyState>
      ) : (
        <div className="cart-drawer">
          <FreeShippingProgress amountRemaining={totals.amountToFreeShipping} threshold={totals.freeShippingThreshold} />
          <ul className="cart-drawer__list">
            {items.map((item) => (
              <li key={cartLineKey(item)}>
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

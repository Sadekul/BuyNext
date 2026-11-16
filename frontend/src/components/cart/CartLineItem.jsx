import { Link } from 'react-router'
import { LuTrash2 } from 'react-icons/lu'
import QuantitySelector from '../product/QuantitySelector'
import { ROUTES } from '../../constants/routes'
import { cn } from '../../utils/classNames'
import { formatPrice } from '../../utils/formatters'
import { getPurchaseLimits } from '../../utils/inventory'
import { getProductPricing } from '../../utils/pricing'
import { cartLineKey } from '../../reducers/cartReducer'
import './CartLineItem.css'

/** One cart row. `compact` is used in the drawer; the cart page uses the full layout. */
function CartLineItem({ item, onQuantityChange, onRemove, onNavigate, compact = false }) {
  const { salePrice, originalPrice, hasDiscount } = getProductPricing(item)
  const limits = getPurchaseLimits(item)
  const lineTotal = salePrice * item.quantity
  const key = cartLineKey(item)
  const name = item.variantLabel ? `${item.title} (${item.variantLabel})` : item.title

  return (
    <article className={cn('cart-line', compact && 'cart-line--compact', item.isUnavailable && 'cart-line--unavailable')}>
      <img className="cart-line__image" src={item.thumbnail} alt="" width="96" height="96" loading="lazy" />

      <div className="cart-line__info">
        <h3 className="cart-line__title">
          <Link to={ROUTES.productDetails(item.productId)} onClick={onNavigate}>
            {item.title}
          </Link>
        </h3>
        {item.variantLabel && <p className="cart-line__variant">{item.variantLabel}</p>}
        {!compact && item.brand && <p className="cart-line__brand">{item.brand}</p>}
        <p className="cart-line__unit-price">
          {formatPrice(salePrice)}
          {hasDiscount && <s>{formatPrice(originalPrice)}</s>}
          <span className="visually-hidden"> each</span>
        </p>
        {/* Announced through the page's summary live region, not individually. */}
        {item.notice && <p className="cart-line__notice">{item.notice}</p>}

        <div className="cart-line__controls">
          {!item.isUnavailable && (
            <QuantitySelector
              value={item.quantity}
              min={limits.min}
              max={limits.max}
              onChange={(quantity) => onQuantityChange(key, quantity)}
              label={`Quantity for ${name}`}
              size="sm"
            />
          )}
          <button
            type="button"
            className="cart-line__remove"
            onClick={() => onRemove(key)}
            aria-label={`Remove ${name} from cart`}
          >
            <LuTrash2 aria-hidden="true" />
            {!compact && 'Remove'}
          </button>
        </div>
      </div>

      <p className="cart-line__total">
        <span className="visually-hidden">Item subtotal: </span>
        {item.isUnavailable ? '—' : formatPrice(lineTotal)}
      </p>
    </article>
  )
}

export default CartLineItem

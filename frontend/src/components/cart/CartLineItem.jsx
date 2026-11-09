import { Link } from 'react-router'
import { LuTrash2 } from 'react-icons/lu'
import QuantitySelector from '../product/QuantitySelector'
import { ROUTES } from '../../constants/routes'
import { cn } from '../../utils/classNames'
import { formatPrice } from '../../utils/formatters'
import { getPurchaseLimits } from '../../utils/inventory'
import { getProductPricing } from '../../utils/pricing'
import './CartLineItem.css'

/** One cart row. `compact` is used in the drawer; the cart page uses the full layout. */
function CartLineItem({ item, onQuantityChange, onRemove, onNavigate, compact = false }) {
  const { salePrice, originalPrice, hasDiscount } = getProductPricing(item)
  const limits = getPurchaseLimits(item)
  const lineTotal = salePrice * item.quantity

  return (
    <article className={cn('cart-line', compact && 'cart-line--compact', item.isUnavailable && 'cart-line--unavailable')}>
      <img className="cart-line__image" src={item.thumbnail} alt="" width="96" height="96" loading="lazy" />

      <div className="cart-line__info">
        <h3 className="cart-line__title">
          <Link to={ROUTES.productDetails(item.productId)} onClick={onNavigate}>
            {item.title}
          </Link>
        </h3>
        {!compact && item.brand && <p className="cart-line__brand">{item.brand}</p>}
        <p className="cart-line__unit-price">
          {formatPrice(salePrice)}
          {hasDiscount && <s>{formatPrice(originalPrice)}</s>}
          <span className="visually-hidden"> each</span>
        </p>
        {item.notice && (
          <p className="cart-line__notice" role="status">
            {item.notice}
          </p>
        )}

        <div className="cart-line__controls">
          {!item.isUnavailable && (
            <QuantitySelector
              value={item.quantity}
              min={limits.min}
              max={limits.max}
              onChange={(quantity) => onQuantityChange(item.productId, quantity)}
              label={`Quantity for ${item.title}`}
              size="sm"
            />
          )}
          <button
            type="button"
            className="cart-line__remove"
            onClick={() => onRemove(item.productId)}
            aria-label={`Remove ${item.title} from cart`}
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

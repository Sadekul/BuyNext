import { Link } from 'react-router'
import { LuTrash2 } from 'react-icons/lu'
import QuantitySelector from '../product/QuantitySelector'
import { ROUTES } from '../../constants/routes'
import { cn } from '../../utils/classNames'
import { formatNumber, formatPrice } from '../../utils/formatters'
import { getPurchaseLimits } from '../../utils/inventory'
import { getProductPricing } from '../../utils/pricing'
import { cartLineKey } from '../../reducers/cartReducer'
import { recipientLabel } from '../../utils/giftCards'
import './CartLineItem.css'
import { useTranslation } from 'react-i18next'

/**
 * One cart row. `compact` is used in the drawer; the cart page uses the full layout.
 * `pricedLine` (REAL_SHOP): the server's line for this item. Its prices win
 * (they include a customer group's discount) while its quantity matches.
 */
function CartLineItem({ item, onQuantityChange, onRemove, onNavigate, pricedLine, compact = false }) {
  const { t } = useTranslation('cart')
  const local = getProductPricing(item)
  const server = pricedLine?.available !== false && typeof pricedLine?.salePrice === 'number' && pricedLine.quantity === item.quantity ? pricedLine : null
  const salePrice = server ? server.salePrice : local.salePrice
  const originalPrice = server ? (server.price ?? local.originalPrice) : local.originalPrice
  const hasDiscount = server ? salePrice < originalPrice : local.hasDiscount
  const limits = getPurchaseLimits(item)
  const lineTotal = server ? server.lineTotal : salePrice * item.quantity
  const key = cartLineKey(item)
  // Phase 10: a gift card line names who receives it (two cards for two people are two lines).
  const name = item.giftCard ? t('line.giftFor', { title: item.title, name: item.giftCard.recipientName }) : item.variantLabel ? `${item.title} (${item.variantLabel})` : item.title

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
        {item.giftCard && <p className="cart-line__variant cart-line__recipient">{recipientLabel(item.giftCard)}</p>}
        {item.giftCard?.message && !compact && <p className="cart-line__brand">“{item.giftCard.message}”</p>}
        {!compact && item.brand && <p className="cart-line__brand">{item.brand}</p>}
        <p className="cart-line__unit-price">
          {formatPrice(salePrice)}
          {hasDiscount && <s>{formatPrice(originalPrice)}</s>}
          <span className="visually-hidden">{t('line.each')}</span>
        </p>
        {/* Phase 7: the catalog price rule that set this price ("VIP price", "Black Friday"). */}
        {server?.priceLabel && <p className="cart-line__price-label">{server.priceLabel}</p>}
        {server?.groupDiscountPercent > 0 && <p className="cart-line__group">{t('line.groupDiscount', { percent: formatNumber(Number(server.groupDiscountPercent.toFixed(2))) })}</p>}
        {/* Announced through the page's summary live region, not individually. */}
        {item.notice && <p className="cart-line__notice">{item.notice}</p>}

        <div className="cart-line__controls">
          {!item.isUnavailable && (
            <QuantitySelector
              value={item.quantity}
              min={limits.min}
              max={limits.max}
              onChange={(quantity) => onQuantityChange(key, quantity)}
              label={t('line.quantityFor', { name })}
              size="sm"
            />
          )}
          <button
            type="button"
            className="cart-line__remove"
            onClick={() => onRemove(key)}
            aria-label={t('line.removeLabel', { name })}
          >
            <LuTrash2 aria-hidden="true" />
            {!compact && t('line.remove')}
          </button>
        </div>
      </div>

      <p className="cart-line__total">
        <span className="visually-hidden">{t('line.itemSubtotal')}</span>
        {item.isUnavailable ? '—' : formatPrice(lineTotal)}
      </p>
    </article>
  )
}

export default CartLineItem

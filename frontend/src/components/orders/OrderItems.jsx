import { Link } from 'react-router'
import { ROUTES } from '../../constants/routes'
import { formatBasePrice } from '../../utils/formatters'
import { getProductPricing } from '../../utils/pricing'
import { recipientLabel } from '../../utils/giftCards'
import './OrderItems.css'

/**
 * Compact list of order or checkout lines. `items` use cart/order item shape.
 * Lines priced by the server bring their own `salePrice` and `lineTotal`;
 * those win over the local calculation. Variant lines show their label
 * ("Size: M / Color: Red").
 */
function OrderItems({ items }) {
  return (
    <ul className="order-items">
      {items.map((item, index) => {
        const salePrice = item.salePrice ?? getProductPricing(item).salePrice
        const lineTotal = item.lineTotal ?? salePrice * item.quantity
        return (
          // Two variants of one product are two lines: the key includes the variant.
          <li key={`${item.productId ?? item.sku}-${item.variantId ?? item.giftCard?.id ?? ''}-${index}`} className="order-items__row">
            <span className="order-items__thumb">
              <img src={item.thumbnail} alt="" width="56" height="56" loading="lazy" />
              <span className="order-items__qty" aria-hidden="true">
                {item.quantity}
              </span>
            </span>
            <span className="order-items__title">
              {/* A product deleted since the order has no page any more. */}
              {item.productId ? <Link to={ROUTES.productDetails(item.productId)}>{item.title}</Link> : item.title}
              {item.variantLabel && <span className="order-items__variant">{item.variantLabel}</span>}
              {/* Phase 10: a gift card names its recipient (never its code). */}
              {item.giftCard?.recipientName && <span className="order-items__variant">{recipientLabel(item.giftCard)}</span>}
              {/* Phase 7: the catalog price rule that set the price ("VIP price", "Black Friday"). */}
              {item.priceLabel && <span className="order-items__price-label">{item.priceLabel}</span>}
              <span className="order-items__meta">
                {item.quantity} × {formatBasePrice(salePrice)}
              </span>
            </span>
            <span className="order-items__total">{formatBasePrice(lineTotal)}</span>
          </li>
        )
      })}
    </ul>
  )
}

export default OrderItems

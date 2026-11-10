import { Link } from 'react-router'
import { ROUTES } from '../../constants/routes'
import { formatPrice } from '../../utils/formatters'
import { getProductPricing } from '../../utils/pricing'
import './OrderItems.css'

/**
 * Compact list of order or checkout lines. `items` use cart/order item shape.
 * Lines priced by the server bring their own `salePrice` and `lineTotal`;
 * those win over the local calculation.
 */
function OrderItems({ items }) {
  return (
    <ul className="order-items">
      {items.map((item, index) => {
        const salePrice = item.salePrice ?? getProductPricing(item).salePrice
        const lineTotal = item.lineTotal ?? salePrice * item.quantity
        return (
          <li key={item.productId ?? `${item.sku}-${index}`} className="order-items__row">
            <span className="order-items__thumb">
              <img src={item.thumbnail} alt="" width="56" height="56" loading="lazy" />
              <span className="order-items__qty" aria-hidden="true">
                {item.quantity}
              </span>
            </span>
            <span className="order-items__title">
              {/* A product deleted since the order has no page any more. */}
              {item.productId ? <Link to={ROUTES.productDetails(item.productId)}>{item.title}</Link> : item.title}
              <span className="order-items__meta">
                {item.quantity} × {formatPrice(salePrice)}
              </span>
            </span>
            <span className="order-items__total">{formatPrice(lineTotal)}</span>
          </li>
        )
      })}
    </ul>
  )
}

export default OrderItems

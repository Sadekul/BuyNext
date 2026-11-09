import { Link } from 'react-router'
import { ROUTES } from '../../constants/routes'
import { formatPrice } from '../../utils/formatters'
import { getProductPricing } from '../../utils/pricing'
import './OrderItems.css'

/** Compact list of order or checkout lines. `items` use cart/order item shape. */
function OrderItems({ items }) {
  return (
    <ul className="order-items">
      {items.map((item) => {
        const { salePrice } = getProductPricing(item)
        return (
          <li key={item.productId} className="order-items__row">
            <span className="order-items__thumb">
              <img src={item.thumbnail} alt="" width="56" height="56" loading="lazy" />
              <span className="order-items__qty" aria-hidden="true">
                {item.quantity}
              </span>
            </span>
            <span className="order-items__title">
              <Link to={ROUTES.productDetails(item.productId)}>{item.title}</Link>
              <span className="order-items__meta">
                {item.quantity} × {formatPrice(salePrice)}
              </span>
            </span>
            <span className="order-items__total">{formatPrice(salePrice * item.quantity)}</span>
          </li>
        )
      })}
    </ul>
  )
}

export default OrderItems

import { Link } from 'react-router'
import { LuShoppingBag } from 'react-icons/lu'
import Button from '../ui/Button'
import ProductBadge from './ProductBadge'
import RatingStars from './RatingStars'
import { ROUTES } from '../../constants/routes'
import { STORE_SETTINGS } from '../../constants/store'
import { formatPrice, getDiscountedPrice } from '../../utils/formatters'
import './ProductCard.css'

/**
 * One product tile. Receives a product object (DummyJSON shape) and an
 * optional `onAddToCart` function prop; the card only reports the click,
 * the parent decides what "add to cart" does.
 *
 * Pricing assumption: DummyJSON's `price` is treated as the list price and
 * `discountPercentage` as the discount off it. Display only — the backend
 * must calculate real prices at checkout.
 */
function ProductCard({ product, onAddToCart }) {
  const { id, title, brand, thumbnail, price, discountPercentage, rating, stock, availabilityStatus } = product

  const roundedDiscount = Math.round(discountPercentage)
  const hasDiscount = roundedDiscount >= 1
  const salePrice = hasDiscount ? getDiscountedPrice(price, discountPercentage) : price
  const isOutOfStock = stock === 0
  const productUrl = ROUTES.productDetails(id)

  return (
    <article className="product-card">
      {/* Decorative: the title link (stretched over the card) names the product. */}
      <div className="product-card__media">
        <img src={thumbnail} alt="" loading="lazy" width="300" height="300" />
      </div>

      <div className="product-card__badges">
        {hasDiscount && roundedDiscount >= STORE_SETTINGS.saleBadgeMinDiscount && (
          <ProductBadge variant="sale">-{roundedDiscount}%</ProductBadge>
        )}
        {isOutOfStock && <ProductBadge variant="danger">Out of stock</ProductBadge>}
        {availabilityStatus === 'Low Stock' && <ProductBadge variant="warning">Low stock</ProductBadge>}
      </div>

      <div className="product-card__body">
        {brand && <p className="product-card__brand">{brand}</p>}
        <h3 className="product-card__title">
          <Link to={productUrl}>{title}</Link>
        </h3>
        {rating !== null && <RatingStars rating={rating} />}

        <p className="product-card__price">
          <span className="visually-hidden">{hasDiscount ? 'Sale price:' : 'Price:'}</span>
          <span className="product-card__price-current">{formatPrice(salePrice)}</span>
          {hasDiscount && (
            <>
              <span className="visually-hidden">Original price:</span>
              <s className="product-card__price-original">{formatPrice(price)}</s>
            </>
          )}
        </p>

        {onAddToCart && (
          <Button
            variant={isOutOfStock ? 'outline' : 'primary'}
            size="sm"
            fullWidth
            disabled={isOutOfStock}
            onClick={() => onAddToCart(product)}
            className="product-card__action"
          >
            <LuShoppingBag aria-hidden="true" />
            {isOutOfStock ? 'Sold out' : 'Add to cart'}
          </Button>
        )}
      </div>
    </article>
  )
}

export default ProductCard

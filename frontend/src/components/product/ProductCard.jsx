import { Link } from 'react-router'
import { LuEye, LuHeart, LuShoppingBag } from 'react-icons/lu'
import Button from '../ui/Button'
import ProductBadge from './ProductBadge'
import RatingStars from './RatingStars'
import { ROUTES } from '../../constants/routes'
import { STORE_SETTINGS } from '../../constants/store'
import { cn } from '../../utils/classNames'
import { formatPrice, formatSlug } from '../../utils/formatters'
import { getProductPricing } from '../../utils/pricing'
import './ProductCard.css'

const AVAILABILITY_TONE = { 'In Stock': 'success', 'Low Stock': 'warning', 'Out of Stock': 'danger' }

/**
 * One product tile, in "grid" or "list" layout.
 * Every action is an optional function prop — the card only reports clicks;
 * the parent decides what "add to cart", "wishlist", or "quick view" do.
 * A button is only rendered when its handler is provided.
 */
function ProductCard({ product, layout = 'grid', onAddToCart, onToggleWishlist, isWishlisted = false, onQuickView }) {
  const { id, title, brand, category, thumbnail, rating, stock, availabilityStatus } = product
  const { hasDiscount, roundedDiscount, salePrice, originalPrice } = getProductPricing(product)
  const isOutOfStock = stock === 0
  const productUrl = ROUTES.productDetails(id)

  return (
    <article className={cn('product-card', `product-card--${layout}`)}>
      {/* Decorative: the title link (stretched over the card) names the product. */}
      <div className="product-card__media">
        <img src={thumbnail} alt="" loading="lazy" width="300" height="300" />
        {onQuickView && (
          <button
            type="button"
            className="product-card__quick-view"
            onClick={() => onQuickView(product)}
            aria-label={`Quick view: ${title}`}
          >
            <LuEye aria-hidden="true" />
            Quick view
          </button>
        )}
      </div>

      <div className="product-card__badges">
        {hasDiscount && roundedDiscount >= STORE_SETTINGS.saleBadgeMinDiscount && (
          <ProductBadge variant="sale">-{roundedDiscount}%</ProductBadge>
        )}
        {isOutOfStock && <ProductBadge variant="danger">Out of stock</ProductBadge>}
        {availabilityStatus === 'Low Stock' && <ProductBadge variant="warning">Low stock</ProductBadge>}
      </div>

      {onToggleWishlist && (
        <button
          type="button"
          className={cn('product-card__wishlist', isWishlisted && 'product-card__wishlist--active')}
          onClick={() => onToggleWishlist(product)}
          aria-pressed={isWishlisted}
          aria-label={`${isWishlisted ? 'Remove' : 'Add'} ${title} ${isWishlisted ? 'from' : 'to'} wishlist`}
        >
          <LuHeart aria-hidden="true" />
        </button>
      )}

      <div className="product-card__body">
        <p className="product-card__meta">
          {brand && <span className="product-card__brand">{brand}</span>}
          {layout === 'list' && category && <span className="product-card__category">{formatSlug(category)}</span>}
        </p>
        <h3 className="product-card__title">
          <Link to={productUrl}>{title}</Link>
        </h3>
        {rating !== null && <RatingStars rating={rating} />}

        {layout === 'list' && availabilityStatus && (
          <p className={`product-card__availability product-card__availability--${AVAILABILITY_TONE[availabilityStatus] ?? 'success'}`}>
            {availabilityStatus}
          </p>
        )}

        <p className="product-card__price">
          <span className="visually-hidden">{hasDiscount ? 'Sale price:' : 'Price:'}</span>
          <span className="product-card__price-current">{formatPrice(salePrice)}</span>
          {hasDiscount && (
            <>
              <span className="visually-hidden">Original price:</span>
              <s className="product-card__price-original">{formatPrice(originalPrice)}</s>
              {layout === 'list' && <span className="product-card__saving">Save {roundedDiscount}%</span>}
            </>
          )}
        </p>

        {onAddToCart && (
          <Button
            variant={isOutOfStock ? 'outline' : 'primary'}
            size="sm"
            fullWidth={layout === 'grid'}
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

import { memo } from 'react'
import { Link } from 'react-router'
import { LuEye, LuShoppingBag } from 'react-icons/lu'
import Button from '../ui/Button'
import ProductBadge from './ProductBadge'
import RatingStars from './RatingStars'
import WishlistButton from './WishlistButton'
import { ROUTES } from '../../constants/routes'
import { STORE_SETTINGS } from '../../constants/store'
import { cn } from '../../utils/classNames'
import { formatPrice, formatSlug } from '../../utils/formatters'
import { getProductPricing } from '../../utils/pricing'
import { getPurchaseLimits } from '../../utils/inventory'
import { IMAGE_SIZES, responsiveImageProps } from '../../utils/images'
import { isGiftCardProduct } from '../../utils/giftCards'
import './ProductCard.css'

const AVAILABILITY_TONE = { 'In Stock': 'success', 'Low Stock': 'warning', 'Out of Stock': 'danger' }

/**
 * One product tile, in "grid" or "list" layout.
 * "Add to cart" and "Quick view" are optional function props — the card only
 * reports clicks and the parent decides what happens; each button renders
 * only when its handler is provided. The wishlist heart is self-contained
 * (WishlistButton reads the wishlist context), shown unless showWishlist={false}.
 */
function ProductCard({ product, layout = 'grid', onAddToCart, onQuickView, showWishlist = true }) {
  const { id, title, brand, category, thumbnail, rating, stock, availabilityStatus } = product
  const { hasDiscount, roundedDiscount, salePrice, originalPrice } = getProductPricing(product)
  const isOutOfStock = stock === 0
  const { canBuy } = getPurchaseLimits(product)
  const productUrl = ROUTES.productDetails(id)
  const isGiftCard = isGiftCardProduct(product)
  const choosesOnPage = product.hasVariants || isGiftCard

  return (
    <article className={cn('product-card', `product-card--${layout}`)}>
      {/* Decorative: the title link (stretched over the card) names the product. */}
      <div className="product-card__media">
        {/* Phase 9: the resized copies (srcset) when the API made them; the original otherwise. */}
        <img
          {...responsiveImageProps(thumbnail, product.thumbnailVariants, layout === 'list' ? IMAGE_SIZES.listCard : IMAGE_SIZES.card)}
          src={thumbnail}
          alt=""
          loading="lazy"
          width="300"
          height="300"
        />
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

      {showWishlist && <WishlistButton product={product} className="product-card__wishlist" />}

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

        {/* A product with options (size, color) is bought on its page, where a variant is chosen;
            a gift card too (phase 10), where its amount and recipient are chosen. */}
        {onAddToCart && choosesOnPage && (
          <Button
            to={productUrl}
            variant="outline"
            size="sm"
            fullWidth={layout === 'grid'}
            className="product-card__action"
            aria-label={`${isGiftCard ? 'Choose an amount' : 'Choose options'} for ${title}`}
          >
            {isGiftCard ? 'Choose amount' : 'Choose options'}
          </Button>
        )}
        {onAddToCart && !choosesOnPage && (
          <Button
            variant={canBuy ? 'primary' : 'outline'}
            size="sm"
            fullWidth={layout === 'grid'}
            disabled={!canBuy}
            onClick={() => onAddToCart(product)}
            className="product-card__action"
          >
            <LuShoppingBag aria-hidden="true" />
            {isOutOfStock ? 'Sold out' : canBuy ? 'Add to cart' : 'Unavailable'}
          </Button>
        )}
      </div>
    </article>
  )
}

/*
 * React.memo: skip re-rendering a card when its props are unchanged. The
 * catalog re-renders when the cart drawer, quick view, or filters change;
 * memo keeps the 12 cards out of that work. It only helps because the parent
 * passes STABLE props: product objects from the query cache and handlers
 * wrapped in useCallback. (WishlistButton still updates on its own: context
 * changes reach it directly.)
 */
export default memo(ProductCard)

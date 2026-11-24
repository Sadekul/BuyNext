import { memo, useState } from 'react'
import { Link } from 'react-router'
import { LuEye, LuShoppingBag } from 'react-icons/lu'
import Button from '../ui/Button'
import ProductBadge from './ProductBadge'
import RatingStars from './RatingStars'
import WishlistButton from './WishlistButton'
import CompareButton from './CompareButton'
import { ROUTES } from '../../constants/routes'
import { STORE_SETTINGS } from '../../constants/store'
import { cn } from '../../utils/classNames'
import { formatPrice, formatSlug } from '../../utils/formatters'
import { useDisplayCurrency } from '../../utils/displayCurrency'
import { getProductPricing } from '../../utils/pricing'
import { getPurchaseLimits } from '../../utils/inventory'
import { IMAGE_SIZES, responsiveImageProps } from '../../utils/images'
import { isGiftCardProduct } from '../../utils/giftCards'
import { availabilityLabel } from '../../utils/catalogText'
import { fromPrice } from '../../utils/variants'
import './ProductCard.css'
import { useTranslation } from 'react-i18next'

const AVAILABILITY_TONE = { 'In Stock': 'success', 'Low Stock': 'warning', 'Out of Stock': 'danger' }
// Phase 16: colour dots shown on a card; the rest are counted ("+3").
const MAX_SWATCHES = 5

/**
 * One product tile, in "grid" or "list" layout.
 * "Add to cart" and "Quick view" are optional function props — the card only
 * reports clicks and the parent decides what happens; each button renders
 * only when its handler is provided. The wishlist heart is self-contained
 * (WishlistButton reads the wishlist context), shown unless showWishlist={false}.
 */
function ProductCard({ product, layout = 'grid', onAddToCart, onQuickView, showWishlist = true, showCompare = true }) {
  const { t } = useTranslation('catalog')
  // Phase 11: memo() skips re-renders from the parent, so the card follows the display currency itself.
  useDisplayCurrency()
  const { id, title, brand, category, thumbnail, rating, stock, availabilityStatus } = product
  // Phase 16: configurable products whose variants cost differently show "From ৳x" (the lowest final price).
  const from = fromPrice(product)
  const { hasDiscount, roundedDiscount, salePrice, originalPrice } = getProductPricing(from === null ? product : { price: from, discountPercentage: 0 })
  const swatches = product.swatches ?? []
  // Phase 16: hovering a colour dot (pointer only) shows that colour's photo; same box, no layout shift.
  const [hoverImage, setHoverImage] = useState(null)
  const isOutOfStock = stock === 0
  const { canBuy, min: minQuantity } = getPurchaseLimits(product)
  const productUrl = ROUTES.productDetails(id)
  const isGiftCard = isGiftCardProduct(product)
  const choosesOnPage = product.hasVariants || isGiftCard

  return (
    <article className={cn('product-card', `product-card--${layout}`)}>
      {/* Decorative: the title link (stretched over the card) names the product. */}
      <div className="product-card__media">
        {/* Phase 9: the resized copies (srcset) when the API made them; the original otherwise. */}
        {hoverImage ? (
          <img src={hoverImage} alt="" width="300" height="300" />
        ) : (
          <img
            {...responsiveImageProps(thumbnail, product.thumbnailVariants, layout === 'list' ? IMAGE_SIZES.listCard : IMAGE_SIZES.card)}
            src={thumbnail}
            alt=""
            loading="lazy"
            width="300"
            height="300"
          />
        )}
        {onQuickView && (
          <button
            type="button"
            className="product-card__quick-view"
            onClick={() => onQuickView(product)}
            aria-label={t('card.quickViewLabel', { title })}
          >
            <LuEye aria-hidden="true" />
            {t('card.quickView')}
          </button>
        )}
      </div>

      <div className="product-card__badges">
        {hasDiscount && roundedDiscount >= STORE_SETTINGS.saleBadgeMinDiscount && (
          <ProductBadge variant="sale">{t('card.salePercent', { percent: roundedDiscount })}</ProductBadge>
        )}
        {isOutOfStock && <ProductBadge variant="danger">{t('card.outOfStock')}</ProductBadge>}
        {availabilityStatus === 'Low Stock' && <ProductBadge variant="warning">{t('card.lowStock')}</ProductBadge>}
      </div>

      {(showWishlist || showCompare) && (
        <div className="product-card__toggles">
          {showWishlist && <WishlistButton product={product} />}
          {/* Phase 11: add to the compare list (max 4). */}
          {showCompare && <CompareButton product={product} />}
        </div>
      )}

      <div className="product-card__body">
        <p className="product-card__meta">
          {brand && <span className="product-card__brand">{brand}</span>}
          {layout === 'list' && category && <span className="product-card__category">{product.categoryName ?? formatSlug(category)}</span>}
        </p>
        <h3 className="product-card__title">
          <Link to={productUrl}>{title}</Link>
        </h3>
        {rating !== null && <RatingStars rating={rating} />}

        {layout === 'list' && availabilityStatus && (
          <p className={`product-card__availability product-card__availability--${AVAILABILITY_TONE[availabilityStatus] ?? 'success'}`}>
            {availabilityLabel(availabilityStatus)}
          </p>
        )}

        {swatches.length > 0 && (
          <p className="product-card__swatches">
            {/* The dots are decorative (the title link names the product); the count is read instead. */}
            <span className="visually-hidden">{t('card.colours', { count: swatches.length })}</span>
            {swatches.slice(0, MAX_SWATCHES).map((swatch) => (
              <span
                key={swatch.valueId ?? swatch.value}
                className={cn('product-card__swatch', !swatch.swatch && 'product-card__swatch--plain')}
                style={swatch.swatch ? { backgroundColor: swatch.swatch } : undefined}
                title={swatch.value}
                aria-hidden="true"
                onPointerEnter={(event) => event.pointerType === 'mouse' && swatch.imageUrl && setHoverImage(swatch.imageUrl)}
                onPointerLeave={() => setHoverImage(null)}
              />
            ))}
            {swatches.length > MAX_SWATCHES && (
              <span className="product-card__swatch-more" aria-hidden="true">
                {t('card.moreSwatches', { count: swatches.length - MAX_SWATCHES })}
              </span>
            )}
          </p>
        )}

        <p className="product-card__price">
          <span className="visually-hidden">{t(hasDiscount ? 'card.salePrice' : 'card.price')}</span>
          <span className="product-card__price-current">
            {from !== null && <span className="product-card__price-from">{t('card.from')}</span>}
            {formatPrice(salePrice)}
          </span>
          {hasDiscount && (
            <>
              <span className="visually-hidden">{t('card.originalPrice')}</span>
              <s className="product-card__price-original">{formatPrice(originalPrice)}</s>
              {layout === 'list' && <span className="product-card__saving">{t('card.save', { percent: roundedDiscount })}</span>}
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
            aria-label={t(isGiftCard ? 'card.chooseAmountFor' : 'card.chooseOptionsFor', { title })}
          >
            {t(isGiftCard ? 'card.chooseAmount' : 'card.chooseOptions')}
          </Button>
        )}
        {/* A product with a minimum order adds that many at once: say so before the click. */}
        {onAddToCart && !choosesOnPage && canBuy && minQuantity > 1 && (
          <p className="product-card__note">{t('card.minimum', { count: minQuantity })}</p>
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
            {t(isOutOfStock ? 'card.soldOut' : canBuy ? 'card.addToCart' : 'card.unavailable')}
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

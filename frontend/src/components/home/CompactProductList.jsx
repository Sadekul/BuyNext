import { useId } from 'react'
import { Link } from 'react-router'
import { LuArrowRight } from 'react-icons/lu'
import { useTranslation } from 'react-i18next'
import RatingStars from '../product/RatingStars'
import { ROUTES } from '../../constants/routes'
import { formatPrice } from '../../utils/formatters'
import { useDisplayCurrency } from '../../utils/displayCurrency'
import { getProductPricing } from '../../utils/pricing'
import { fromPrice } from '../../utils/variants'
import '../product/ProductGridSkeleton.css'
import './CompactProductList.css'

/**
 * One compact product list (phase 17, PHASE17_CONTRACT.md §4.5): a heading,
 * "View all" (the catalog with the matching sort), and up to four rows with a
 * thumbnail, the name (the link to the product), the rating, and the price
 * (sale price, then the original one struck through, like the product card).
 *
 *   section (named by its h3)
 *     ol  li: img (decorative) · link "<name>" · rating (role img) · price
 */
function CompactProductList({ title, products, isLoading = false, viewAllTo, rows = 4 }) {
  const { t } = useTranslation('marketing')
  const headingId = useId()
  if (!isLoading && products.length === 0) return null

  return (
    <section className="compact-list" aria-labelledby={headingId}>
      <div className="compact-list__head">
        <h3 id={headingId} className="compact-list__title">
          {title}
        </h3>
        {viewAllTo && (
          <Link to={viewAllTo} className="compact-list__all" aria-label={t('home.viewAllNamed', { title })}>
            {t('home.lists.viewAll')}
            <LuArrowRight aria-hidden="true" />
          </Link>
        )}
      </div>
      {isLoading ? (
        <div role="status" className="compact-list__loading">
          <span className="visually-hidden">{t('home.lists.loading', { title })}</span>
          {Array.from({ length: rows }, (_, index) => (
            <span key={index} className="compact-list__placeholder skeleton" aria-hidden="true" />
          ))}
        </div>
      ) : (
        <ol className="compact-list__items">
          {products.slice(0, rows).map((product) => (
            <CompactProduct key={product.id} product={product} />
          ))}
        </ol>
      )}
    </section>
  )
}

function CompactProduct({ product }) {
  const { t } = useTranslation('catalog')
  useDisplayCurrency() // follows the shopper's display currency (phase 11), like ProductCard
  const from = fromPrice(product)
  const { hasDiscount, salePrice, originalPrice } = getProductPricing(from === null ? product : { price: from, discountPercentage: 0 })

  return (
    <li className="compact-product">
      <span className="compact-product__media">
        {product.thumbnail && <img src={product.thumbnail} alt="" loading="lazy" width="80" height="80" />}
      </span>
      <div className="compact-product__body">
        <Link to={ROUTES.productDetails(product.id)} className="compact-product__name">
          {product.title}
        </Link>
        {typeof product.rating === 'number' && <RatingStars rating={product.rating} />}
        <p className="compact-product__price">
          <span className="visually-hidden">{t(hasDiscount ? 'card.salePrice' : 'card.price')}</span>
          <span className="compact-product__price-current">
            {from !== null && <span className="compact-product__from">{t('card.from')} </span>}
            {formatPrice(salePrice)}
          </span>
          {hasDiscount && (
            <>
              <span className="visually-hidden">{t('card.originalPrice')}</span>
              <s className="compact-product__price-original">{formatPrice(originalPrice)}</s>
            </>
          )}
        </p>
      </div>
    </li>
  )
}

export default CompactProductList

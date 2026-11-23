import { useId } from 'react'
import ProductGrid from './ProductGrid'
import { clearRecentlyViewed, useRecentlyViewed } from '../../utils/recentlyViewed'
import './RecentlyViewed.css'
import { useTranslation } from 'react-i18next'

/**
 * Phase 11 §6: "Recently viewed" products (this browser only), newest first,
 * with a "Clear" button. `excludeId`: the product page leaves itself out.
 * Nothing is rendered while there is nothing to show.
 */
function RecentlyViewed({ excludeId = null, onAddToCart, className }) {
  const { t } = useTranslation('catalog')
  const products = useRecentlyViewed().filter((product) => product.id !== excludeId)
  const headingId = useId()
  if (products.length === 0) return null

  return (
    <section className={className ?? 'recently-viewed'} aria-labelledby={headingId}>
      <div className="recently-viewed__header">
        <h2 id={headingId}>{t('recent.title')}</h2>
        <button type="button" className="recently-viewed__clear" onClick={clearRecentlyViewed} aria-label={t('recent.clearLabel')}>
          {t('recent.clear')}
        </button>
      </div>
      <ProductGrid products={products} onAddToCart={onAddToCart} />
    </section>
  )
}

export default RecentlyViewed

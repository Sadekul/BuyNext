import { useId } from 'react'
import ProductGrid from './ProductGrid'
import { clearRecentlyViewed, useRecentlyViewed } from '../../utils/recentlyViewed'
import './RecentlyViewed.css'

/**
 * Phase 11 §6: "Recently viewed" products (this browser only), newest first,
 * with a "Clear" button. `excludeId`: the product page leaves itself out.
 * Nothing is rendered while there is nothing to show.
 */
function RecentlyViewed({ excludeId = null, onAddToCart, className }) {
  const products = useRecentlyViewed().filter((product) => product.id !== excludeId)
  const headingId = useId()
  if (products.length === 0) return null

  return (
    <section className={className ?? 'recently-viewed'} aria-labelledby={headingId}>
      <div className="recently-viewed__header">
        <h2 id={headingId}>Recently viewed</h2>
        <button type="button" className="recently-viewed__clear" onClick={clearRecentlyViewed} aria-label="Clear recently viewed products">
          Clear
        </button>
      </div>
      <ProductGrid products={products} onAddToCart={onAddToCart} />
    </section>
  )
}

export default RecentlyViewed

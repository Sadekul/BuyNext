import './ProductGrid.css'
import './ProductGridSkeleton.css'

/**
 * Grey placeholder cards shown while products load. Matches the real grid's
 * layout so the page doesn't jump when data arrives.
 */
function ProductGridSkeleton({ count = 8, label = 'Loading products…' }) {
  return (
    <div role="status">
      <span className="visually-hidden">{label}</span>
      <ul className="product-grid" aria-hidden="true">
        {/* Index keys are fine: placeholders have no identity and never reorder. */}
        {Array.from({ length: count }, (_, index) => (
          <li key={index} className="product-skeleton">
            <div className="product-skeleton__media skeleton" />
            <div className="product-skeleton__body">
              <div className="skeleton product-skeleton__line product-skeleton__line--short" />
              <div className="skeleton product-skeleton__line" />
              <div className="skeleton product-skeleton__line product-skeleton__line--medium" />
              <div className="skeleton product-skeleton__button" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default ProductGridSkeleton

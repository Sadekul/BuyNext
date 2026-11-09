import { useId } from 'react'
import SectionHeading from '../common/SectionHeading'
import ProductGrid from '../product/ProductGrid'
import ProductGridSkeleton from '../product/ProductGridSkeleton'
import { cn } from '../../utils/classNames'

/**
 * Composition: a heading + a product grid. Featured, New arrivals,
 * Best sellers, and Special offers all reuse this one component.
 */
function ProductSection({ eyebrow, title, description, products, isLoading = false, skeletonCount = 8, viewAllTo, onAddToCart, muted = false }) {
  const headingId = useId()

  return (
    <section className={cn('section', muted && 'section--muted')} aria-labelledby={headingId}>
      <div className="container">
        <SectionHeading
          id={headingId}
          eyebrow={eyebrow}
          title={title}
          description={description}
          viewAllTo={viewAllTo}
        />
        {isLoading ? (
          <ProductGridSkeleton count={skeletonCount} />
        ) : (
          <ProductGrid products={products} onAddToCart={onAddToCart} />
        )}
      </div>
    </section>
  )
}

export default ProductSection

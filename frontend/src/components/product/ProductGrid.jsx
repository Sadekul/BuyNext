import EmptyState from '../ui/EmptyState'
import ProductCard from './ProductCard'
import { cn } from '../../utils/classNames'
import './ProductGrid.css'
import { useTranslation } from 'react-i18next'

/**
 * Responsive list of ProductCards in "grid" or "list" layout.
 * `cardProps` (handlers like onAddToCart) are spread onto every card.
 * Product IDs are stable and unique, so they make ideal keys.
 */
function ProductGrid({ products, layout = 'grid', emptyTitle, ...cardProps }) {
  const { t } = useTranslation('catalog')
  if (products.length === 0) {
    return <EmptyState title={emptyTitle ?? t('grid.empty')} message={t('grid.emptyHint')} />
  }

  return (
    <ul className={cn('product-grid', layout === 'list' && 'product-grid--list')}>
      {products.map((product) => (
        <li key={product.id}>
          <ProductCard product={product} layout={layout} {...cardProps} />
        </li>
      ))}
    </ul>
  )
}

export default ProductGrid

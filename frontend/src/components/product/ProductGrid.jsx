import EmptyState from '../ui/EmptyState'
import ProductCard from './ProductCard'
import './ProductGrid.css'

/**
 * Responsive grid of ProductCards. Passes `onAddToCart` straight through to
 * each card. Product IDs are stable and unique, so they make ideal keys.
 */
function ProductGrid({ products, onAddToCart, emptyTitle = 'No products found' }) {
  if (products.length === 0) {
    return <EmptyState title={emptyTitle} message="Try a different category or search term." />
  }

  return (
    <ul className="product-grid">
      {products.map((product) => (
        <li key={product.id}>
          <ProductCard product={product} onAddToCart={onAddToCart} />
        </li>
      ))}
    </ul>
  )
}

export default ProductGrid

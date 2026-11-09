import './ProductBadge.css'

/** Small pill label. Variants: sale | warning | danger | info */
function ProductBadge({ variant = 'info', children }) {
  return <span className={`product-badge product-badge--${variant}`}>{children}</span>
}

export default ProductBadge

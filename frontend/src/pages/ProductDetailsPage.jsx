import { useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { LuArrowLeft, LuPackageX, LuRotateCcw, LuShieldCheck, LuShoppingBag, LuTruck } from 'react-icons/lu'
import Breadcrumb from '../components/common/Breadcrumb'
import ProductGallery from '../components/product/ProductGallery'
import WishlistButton from '../components/product/WishlistButton'
import ProductBadge from '../components/product/ProductBadge'
import ProductGrid from '../components/product/ProductGrid'
import ProductGridSkeleton from '../components/product/ProductGridSkeleton'
import ProductReviews from '../components/product/ProductReviews'
import QuantitySelector from '../components/product/QuantitySelector'
import RatingStars from '../components/product/RatingStars'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import ErrorMessage from '../components/ui/ErrorMessage'
import Loader from '../components/ui/Loader'
import { useFetch } from '../hooks/useFetch'
import { useCart } from '../hooks/useCart'
import { getProductById, getProductsByCategory } from '../services/productService'
import { ROUTES } from '../constants/routes'
import { SITE } from '../constants/site'
import { formatPrice, formatSlug } from '../utils/formatters'
import { getProductPricing } from '../utils/pricing'
import { getPurchaseLimits } from '../utils/inventory'
import './ProductDetailsPage.css'

const RELATED_LIMIT = 4

/**
 * /products/:productId — route-based data fetching: the URL parameter
 * decides which product to load, so a new :productId means a new request.
 */
function ProductDetailsPage() {
  const { productId } = useParams()
  const isValidId = /^\d+$/.test(productId)

  // Skip the request entirely for IDs that can't exist (e.g. /products/abc).
  const request = useFetch(`product:${productId}`, (signal) =>
    isValidId ? getProductById(productId, { signal }) : Promise.resolve(null),
  )

  if (request.isLoading) {
    return (
      <div className="section container">
        <Loader label="Loading product…" />
      </div>
    )
  }

  const isNotFound = !isValidId || request.error?.status === 404
  if (isNotFound) {
    return (
      <div className="section container">
        <EmptyState icon={LuPackageX} title="Product not found" message="This product doesn't exist or is no longer available.">
          <Button to={ROUTES.products}>Browse all products</Button>
        </EmptyState>
      </div>
    )
  }

  if (request.error) {
    return (
      <div className="section container">
        <ErrorMessage title="We couldn't load this product" message={request.error.message} onRetry={request.retry} />
      </div>
    )
  }

  // `key` = product id: moving from /products/1 to /products/2 reuses this
  // route's component, so without a new key the gallery selection and the
  // chosen quantity would carry over to the next product.
  return <ProductDetails key={request.data.id} product={request.data} />
}

function ProductDetails({ product }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { addItem } = useCart()

  const { min: minQuantity, canBuy } = getPurchaseLimits(product)
  const [quantity, setQuantity] = useState(minQuantity)

  const { hasDiscount, roundedDiscount, salePrice, originalPrice } = getProductPricing(product)
  const images = product.images.length > 0 ? product.images : [product.thumbnail]
  const categoryName = product.category ? formatSlug(product.category) : null

  // location.key is "default" when this page was the first one loaded
  // (e.g. opened from a bookmark), so there's no in-app page to go back to.
  const canGoBack = location.key !== 'default'

  const breadcrumbs = [
    { label: 'Home', to: ROUTES.home },
    ...(product.category ? [{ label: categoryName, to: ROUTES.category(product.category) }] : []),
    { label: product.title },
  ]

  const specifications = [
    ['Brand', product.brand],
    ['Category', categoryName],
    ['SKU', product.sku],
    ['Warranty', product.warrantyInformation],
    ['Shipping', product.shippingInformation],
    ['Returns', product.returnPolicy],
    ['Minimum order', minQuantity > 1 ? `${minQuantity} units` : null],
  ].filter(([, value]) => value) // only show what the API actually provided

  function handleAddToCart() {
    addItem(product, quantity)
  }

  return (
    <div className="product-details section container">
      {/* React 19 moves <title> into <head> automatically. */}
      <title>{`${product.title} | ${SITE.name}`}</title>

      <div className="product-details__top">
        {canGoBack ? (
          <button type="button" className="product-details__back" onClick={() => navigate(-1)}>
            <LuArrowLeft aria-hidden="true" /> Back
          </button>
        ) : null}
        <Breadcrumb items={breadcrumbs} />
      </div>

      <div className="product-details__main">
        <ProductGallery images={images} title={product.title} />

        <div className="product-details__info">
          {product.brand && <p className="product-details__brand">{product.brand}</p>}
          <h1 className="product-details__title">{product.title}</h1>

          {product.rating !== null && (
            <a href="#reviews" className="product-details__rating">
              <RatingStars rating={product.rating} />
              <span>{product.reviews.length} reviews</span>
            </a>
          )}

          <div className="product-details__price">
            <span className="product-details__price-current">{formatPrice(salePrice)}</span>
            {hasDiscount && (
              <>
                <s className="product-details__price-original">
                  <span className="visually-hidden">Original price: </span>
                  {formatPrice(originalPrice)}
                </s>
                <ProductBadge variant="sale">Save {roundedDiscount}%</ProductBadge>
              </>
            )}
          </div>

          <StockStatus product={product} canBuy={canBuy} />

          {product.description && <p className="product-details__description">{product.description}</p>}

          <div className="product-details__purchase">
            {canBuy && (
              <QuantitySelector value={quantity} min={minQuantity} max={product.stock} onChange={setQuantity} />
            )}
            <Button size="lg" onClick={handleAddToCart} disabled={!canBuy} className="product-details__add">
              <LuShoppingBag aria-hidden="true" />
              {canBuy ? 'Add to cart' : 'Unavailable'}
            </Button>
            <WishlistButton product={product} variant="button" />
          </div>
          {canBuy && minQuantity > 1 && (
            <p className="product-details__note">Minimum order quantity: {minQuantity}</p>
          )}

          <ul className="product-details__perks">
            {product.shippingInformation && (
              <li>
                <LuTruck aria-hidden="true" /> {product.shippingInformation}
              </li>
            )}
            {product.returnPolicy && (
              <li>
                <LuRotateCcw aria-hidden="true" /> {product.returnPolicy}
              </li>
            )}
            {product.warrantyInformation && (
              <li>
                <LuShieldCheck aria-hidden="true" /> {product.warrantyInformation}
              </li>
            )}
          </ul>
        </div>
      </div>

      <section className="product-details__section" aria-labelledby="specs-title">
        <h2 id="specs-title">Specifications</h2>
        <dl className="product-details__specs">
          {specifications.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="product-details__section" id="reviews" aria-labelledby="reviews-title">
        <h2 id="reviews-title">Customer reviews</h2>
        <ProductReviews reviews={product.reviews} />
      </section>

      {product.category && (
        <RelatedProducts productId={product.id} categorySlug={product.category} categoryName={categoryName} />
      )}

    </div>
  )
}

function StockStatus({ product, canBuy }) {
  if (product.stock === null) {
    return <p className="product-details__stock product-details__stock--out">Stock information unavailable</p>
  }
  if (product.stock === 0) {
    return <p className="product-details__stock product-details__stock--out">Out of stock</p>
  }
  if (!canBuy) {
    return (
      <p className="product-details__stock product-details__stock--out">
        Only {product.stock} left — below the minimum order of {product.minimumOrderQuantity}
      </p>
    )
  }
  if (product.availabilityStatus === 'Low Stock') {
    return <p className="product-details__stock product-details__stock--low">Low stock — only {product.stock} left</p>
  }
  return <p className="product-details__stock">In stock</p>
}

/** Other products from the same category (server-side category request). */
function RelatedProducts({ productId, categorySlug, categoryName }) {
  const request = useFetch(`related:${categorySlug}`, (signal) =>
    getProductsByCategory(categorySlug, { limit: RELATED_LIMIT + 1, signal }),
  )
  const related = (request.data?.items ?? []).filter((item) => item.id !== productId).slice(0, RELATED_LIMIT)

  if (request.error || (!request.isLoading && related.length === 0)) return null

  return (
    <section className="product-details__section" aria-labelledby="related-title">
      <div className="product-details__section-header">
        <h2 id="related-title">More in {categoryName}</h2>
        <Link to={ROUTES.category(categorySlug)}>View all</Link>
      </div>
      {request.isLoading ? <ProductGridSkeleton count={RELATED_LIMIT} /> : <ProductGrid products={related} />}
    </section>
  )
}

export default ProductDetailsPage

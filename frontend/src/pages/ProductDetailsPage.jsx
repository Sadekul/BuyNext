import { useId, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { LuArrowLeft, LuPackageX, LuRotateCcw, LuShieldCheck, LuShoppingBag, LuTruck } from 'react-icons/lu'
import Breadcrumb from '../components/common/Breadcrumb'
import PageMeta from '../components/common/PageMeta'
import ProductGallery from '../components/product/ProductGallery'
import WishlistButton from '../components/product/WishlistButton'
import ProductBadge from '../components/product/ProductBadge'
import ProductGrid from '../components/product/ProductGrid'
import ProductGridSkeleton from '../components/product/ProductGridSkeleton'
import ProductReviews from '../components/product/ProductReviews'
import QuantitySelector from '../components/product/QuantitySelector'
import ReviewForm from '../components/product/ReviewForm'
import VariantSelector from '../components/product/VariantSelector'
import StockAlertForm from '../components/product/StockAlertForm'
import RatingStars from '../components/product/RatingStars'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import ErrorMessage from '../components/ui/ErrorMessage'
import Loader from '../components/ui/Loader'
import { useQuery } from '@tanstack/react-query'
import { useCart } from '../hooks/useCart'
import { useStoreRedirect } from '../hooks/useStoreRedirect'
import { categoriesQuery, productQuery, relatedProductsQuery } from '../queries/productQueries'
import { HAS_CATEGORY_TREE } from '../services/categoryService'
import { ROUTES } from '../constants/routes'
import { REAL_SHOP } from '../constants/shop'
import { formatPrice, formatSlug } from '../utils/formatters'
import { getProductPricing } from '../utils/pricing'
import { toDescription } from '../utils/pageMeta'
import { clampQuantity, getPurchaseLimits } from '../utils/inventory'
import { categoryAncestors } from '../utils/categories'
import { chooseValue, findVariant, hasVariants, initialSelection, variantPriceRange, withVariant } from '../utils/variants'
import './ProductDetailsPage.css'

const RELATED_LIMIT = 4

/**
 * /products/:productId — route-based data fetching: the URL parameter
 * decides which product to load, so a new :productId means a new request.
 */
function ProductDetailsPage() {
  const { productId } = useParams()
  const isValidId = /^\d+$/.test(productId)

  // `enabled: false` skips the request entirely for IDs that can't exist (e.g. /products/abc).
  const request = useQuery({ ...productQuery(productId), enabled: isValidId })

  if (isValidId && request.isPending) {
    return (
      <div className="section container">
        <Loader label="Loading product…" />
      </div>
    )
  }

  const isNotFound = !isValidId || request.error?.status === 404
  if (isNotFound) return <ProductNotFound />

  if (request.error) {
    return (
      <div className="section container">
        <ErrorMessage title="We couldn't load this product" message={request.error.message} onRetry={() => request.refetch()} />
      </div>
    )
  }

  // `key` = product id: moving from /products/1 to /products/2 reuses this
  // route's component, so without a new key the gallery selection and the
  // chosen quantity would carry over to the next product.
  return <ProductDetails key={request.data.id} product={request.data} />
}

/** A missing product: an admin redirect (phase 7, e.g. for a deleted product) wins, else "not found". */
function ProductNotFound() {
  const { checking } = useStoreRedirect()
  if (checking) {
    return (
      <div className="section container">
        <Loader label="Loading product…" />
      </div>
    )
  }
  return (
    <div className="section container">
      <PageMeta title="Product not found" noindex />
      <EmptyState icon={LuPackageX} title="Product not found" message="This product doesn't exist or is no longer available.">
        <Button to={ROUTES.products}>Browse all products</Button>
      </EmptyState>
    </div>
  )
}

function ProductDetails({ product }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { addItem } = useCart()
  // The category tree (BuyNest's API) names the breadcrumb's parents; the demo needs no extra request.
  const { data: categories } = useQuery({ ...categoriesQuery(), enabled: HAS_CATEGORY_TREE })
  const hintId = useId()

  // Configurable products (BuyNest's API): price, stock, and the cart follow
  // the chosen variant; buying needs a full selection. Other products (and
  // every DummyJSON product) skip this.
  const isConfigurable = hasVariants(product)
  const [selection, setSelection] = useState(() => initialSelection(product))
  const variant = isConfigurable ? findVariant(product, selection) : null
  const purchasable = variant ? withVariant(product, variant) : product
  const needsChoice = isConfigurable && !variant
  const missingOptions = needsChoice ? product.options.filter((option) => selection[option.id] === undefined) : []

  const limits = getPurchaseLimits(purchasable)
  const { min: minQuantity } = limits
  const canBuy = !needsChoice && limits.canBuy
  // Phase 9: sold out (none left, or fewer than the minimum order) → "Email me when it's back".
  const isSoldOut =
    !needsChoice && (variant ? !variant.inStock || (variant.stock !== null && variant.stock < minQuantity) : purchasable.stock !== null && purchasable.stock < minQuantity)
  const [quantity, setQuantity] = useState(minQuantity)
  // A newly chosen variant may have less stock than the quantity picked before.
  const shownQuantity = canBuy ? clampQuantity(quantity, limits) : quantity

  // Before a choice, variants with different prices show the lowest ("From …").
  const priceRange = isConfigurable ? variantPriceRange(product) : null
  const showFrom = needsChoice && priceRange.min !== priceRange.max
  const priced = needsChoice ? { ...product, price: priceRange.min } : purchasable
  const { hasDiscount, roundedDiscount, salePrice, originalPrice } = getProductPricing(priced)
  const images = product.images.length > 0 ? product.images : [product.thumbnail]
  // The category's real name from the tree (BuyNest's API), or the slug made readable.
  const category = categories?.find((candidate) => candidate.slug === product.category)
  const categoryName = product.category ? (category?.name ?? formatSlug(product.category)) : null
  const parentCategories = category && categories ? categoryAncestors(categories, category.slug) : []

  // location.key is "default" when this page was the first one loaded
  // (e.g. opened from a bookmark), so there's no in-app page to go back to.
  const canGoBack = location.key !== 'default'

  const breadcrumbs = [
    { label: 'Home', to: ROUTES.home },
    ...parentCategories.map((parent) => ({ label: parent.name, to: ROUTES.category(parent.slug) })),
    ...(product.category ? [{ label: categoryName, to: ROUTES.category(product.category) }] : []),
    { label: product.title },
  ]

  const specifications = [
    ['Brand', product.brand],
    ['Category', categoryName],
    ['SKU', purchasable.sku],
    ['Warranty', product.warrantyInformation],
    ['Shipping', product.shippingInformation],
    ['Returns', product.returnPolicy],
    ['Minimum order', minQuantity > 1 ? `${minQuantity} units` : null],
  ].filter(([, value]) => value) // only show what the API actually provided

  function handleAddToCart() {
    addItem(purchasable, shownQuantity)
  }

  function handleOptionChange(optionId, valueId) {
    // With BuyNest's API a sold-out variant can be chosen too, to ask for a stock alert.
    setSelection((current) => chooseValue(product, current, optionId, valueId, { soldOut: REAL_SHOP }))
  }

  return (
    <div className="product-details section container">
      {/* The tab title plus search and link-preview tags (the admin's SEO fields when set). */}
      <PageMeta
        title={product.metaTitle ?? product.title}
        description={toDescription(product.metaDescription ?? product.description)}
        image={product.thumbnail}
        type="product"
        canonicalPath={ROUTES.productDetails(product.id)}
      />

      <div className="product-details__top">
        {canGoBack ? (
          <button type="button" className="product-details__back" onClick={() => navigate(-1)}>
            <LuArrowLeft aria-hidden="true" /> Back
          </button>
        ) : null}
        <Breadcrumb items={breadcrumbs} />
      </div>

      <div className="product-details__main">
        <ProductGallery
          images={images}
          title={product.title}
          alts={product.images.length > 0 ? product.imageAlts : undefined}
          variants={product.images.length > 0 ? product.imageVariants : [product.thumbnailVariants ?? null]}
        />

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
            <span className="product-details__price-current">
              {showFrom && <span className="product-details__price-from">From </span>}
              {formatPrice(salePrice)}
            </span>
            {hasDiscount && (
              <>
                <s className="product-details__price-original">
                  <span className="visually-hidden">Original price: </span>
                  {formatPrice(originalPrice)}
                </s>
                <ProductBadge variant="sale">Save {roundedDiscount}%</ProductBadge>
                {/* Phase 7: the store-wide sale (catalog price rule) behind this price. */}
                {product.priceRule && <span className="product-details__price-rule">{product.priceRule.name}</span>}
              </>
            )}
          </div>

          {/* Live region: the stock line changes as options are chosen. */}
          <div aria-live="polite">
            {needsChoice ? (
              <p className="product-details__stock product-details__stock--choose" id={hintId}>
                Choose {missingOptions.map((option) => option.name.toLowerCase()).join(' and ')} to add this to your cart
              </p>
            ) : (
              <StockStatus product={purchasable} canBuy={canBuy} />
            )}
          </div>

          {product.description && <p className="product-details__description">{product.description}</p>}

          {isConfigurable && <VariantSelector product={product} selection={selection} onChange={handleOptionChange} allowSoldOut={REAL_SHOP} />}

          <div className="product-details__purchase">
            {canBuy && (
              <QuantitySelector value={shownQuantity} min={minQuantity} max={purchasable.stock} onChange={setQuantity} />
            )}
            <Button
              size="lg"
              onClick={handleAddToCart}
              disabled={!canBuy}
              className="product-details__add"
              aria-describedby={needsChoice ? hintId : undefined}
            >
              <LuShoppingBag aria-hidden="true" />
              {canBuy || needsChoice ? 'Add to cart' : 'Unavailable'}
            </Button>
            <WishlistButton product={product} variant="button" />
          </div>
          {canBuy && minQuantity > 1 && (
            <p className="product-details__note">Minimum order quantity: {minQuantity}</p>
          )}
          {/* key: a new form (and message) for each variant. */}
          {REAL_SHOP && isSoldOut && (
            <StockAlertForm key={variant?.id ?? 'product'} productId={product.id} variantId={variant?.id ?? null} variantLabel={variant ? purchasable.variantLabel : null} />
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
        {/* Writing reviews needs BuyNest's API and customer accounts. */}
        {REAL_SHOP && <ReviewForm productId={product.id} productTitle={product.title} />}
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
  const request = useQuery(relatedProductsQuery(categorySlug, RELATED_LIMIT))
  const related = (request.data ?? []).filter((item) => item.id !== productId).slice(0, RELATED_LIMIT)

  if (request.error || (!request.isPending && related.length === 0)) return null

  return (
    <section className="product-details__section" aria-labelledby="related-title">
      <div className="product-details__section-header">
        <h2 id="related-title">More in {categoryName}</h2>
        <Link to={ROUTES.category(categorySlug)}>View all</Link>
      </div>
      {request.isPending ? <ProductGridSkeleton count={RELATED_LIMIT} /> : <ProductGrid products={related} />}
    </section>
  )
}

export default ProductDetailsPage

import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { LuArrowLeft, LuPackageX, LuRotateCcw, LuShieldCheck, LuShoppingBag, LuTruck } from 'react-icons/lu'
import Breadcrumb from '../components/common/Breadcrumb'
import PageMeta from '../components/common/PageMeta'
import ProductGallery from '../components/product/ProductGallery'
import WishlistButton from '../components/product/WishlistButton'
import CompareButton from '../components/product/CompareButton'
import RecentlyViewed from '../components/product/RecentlyViewed'
import ProductBadge from '../components/product/ProductBadge'
import ProductGrid from '../components/product/ProductGrid'
import ProductGridSkeleton from '../components/product/ProductGridSkeleton'
import ProductReviews from '../components/product/ProductReviews'
import QuantitySelector from '../components/product/QuantitySelector'
import ReviewForm from '../components/product/ReviewForm'
import VariantSelector from '../components/product/VariantSelector'
import StockAlertForm from '../components/product/StockAlertForm'
import GiftCardForm from '../components/product/GiftCardForm'
import RatingStars from '../components/product/RatingStars'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import ErrorMessage from '../components/ui/ErrorMessage'
import Loader from '../components/ui/Loader'
import { useQuery } from '@tanstack/react-query'
import { useCart } from '../hooks/useCart'
import { useAuth } from '../hooks/useAuth'
import { useStoreSettings } from '../hooks/useStoreSettings'
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
import { chooseValue, findVariant, galleryOrder, hasVariants, initialSelection, searchForSelection, selectionFromSearch, variantPriceRange, withVariant } from '../utils/variants'
import { isGiftCardProduct } from '../utils/giftCards'
import { trackViewItem } from '../utils/analytics'
import { recordRecentlyViewed } from '../utils/recentlyViewed'
import { earnEstimate } from '../utils/rewards'
import './ProductDetailsPage.css'
import { useTranslation } from 'react-i18next'

const RELATED_LIMIT = 4

/**
 * /products/:productId — route-based data fetching: the URL parameter
 * decides which product to load, so a new :productId means a new request.
 */
function ProductDetailsPage() {
  const { t } = useTranslation('catalog')
  const { productId } = useParams()
  const isValidId = /^\d+$/.test(productId)

  // `enabled: false` skips the request entirely for IDs that can't exist (e.g. /products/abc).
  const request = useQuery({ ...productQuery(productId), enabled: isValidId })

  if (isValidId && request.isPending) {
    return (
      <div className="section container">
        <Loader label={t('details.loading')} />
      </div>
    )
  }

  const isNotFound = !isValidId || request.error?.status === 404
  if (isNotFound) return <ProductNotFound />

  if (request.error) {
    return (
      <div className="section container">
        <ErrorMessage title={t('details.failed')} message={request.error.message} onRetry={() => request.refetch()} />
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
  const { t } = useTranslation('catalog')
  const { checking } = useStoreRedirect()
  if (checking) {
    return (
      <div className="section container">
        <Loader label={t('details.loading')} />
      </div>
    )
  }
  return (
    <div className="section container">
      <PageMeta title={t('details.notFound')} noindex />
      <EmptyState icon={LuPackageX} title={t('details.notFound')} message={t('details.notFoundMessage')}>
        <Button to={ROUTES.products}>{t('details.browseAll')}</Button>
      </EmptyState>
    </div>
  )
}

function ProductDetails({ product }) {
  const { t, i18n } = useTranslation('catalog')
  const navigate = useNavigate()
  const location = useLocation()
  const { addItem } = useCart()
  // Phase 10: statistics (only after the visitor accepted them; no personal data).
  useEffect(() => trackViewItem(product), [product])
  // Phase 11: "Recently viewed" (this browser only).
  useEffect(() => recordRecentlyViewed(product), [product])
  const { isAuthenticated } = useAuth()
  const { settings } = useStoreSettings()
  // Phase 10: gift cards are bought by amount, for a recipient (GiftCardForm), not by quantity.
  const isGiftCard = isGiftCardProduct(product)
  // The category tree (BuyNest's API) names the breadcrumb's parents; the demo needs no extra request.
  const { data: categories } = useQuery({ ...categoriesQuery(), enabled: HAS_CATEGORY_TREE })

  // Configurable products (BuyNest's API): price, stock, and the cart follow
  // the chosen variant; buying needs a full selection. Other products (and
  // every DummyJSON product) skip this.
  const isConfigurable = hasVariants(product)
  // Phase 16: a shared link (?color=blue&size=m) opens with that choice; otherwise nothing is
  // chosen while there is a real choice to make (Magento).
  const [selection, setSelection] = useState(() => selectionFromSearch(product, location.search, { soldOut: REAL_SHOP }) ?? initialSelection(product))
  // Phase 16: "Please select Size." per option, after Add to cart without a full choice.
  const [optionErrors, setOptionErrors] = useState({})
  const optionsRef = useRef(null)
  const variant = isConfigurable ? findVariant(product, selection) : null
  const purchasable = variant ? withVariant(product, variant) : product
  const needsChoice = isConfigurable && !variant

  // Phase 16: the address follows a full choice (replaceState: no extra history entries), so it can be shared.
  useEffect(() => {
    if (!isConfigurable) return
    const search = searchForSelection(product, selection, window.location.search)
    if (search !== window.location.search) {
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${search}${window.location.hash}`)
    }
  }, [isConfigurable, product, selection])

  const limits = getPurchaseLimits(purchasable)
  const { min: minQuantity } = limits
  const canBuy = !needsChoice && limits.canBuy
  // Phase 9: sold out (none left, or fewer than the minimum order) → "Email me when it's back".
  const isSoldOut =
    !needsChoice && (variant ? !variant.inStock || (variant.stock !== null && variant.stock < minQuantity) : purchasable.stock !== null && purchasable.stock < minQuantity)
  const [quantity, setQuantity] = useState(minQuantity)
  // A newly chosen variant may have less stock than the quantity picked before.
  const shownQuantity = canBuy ? clampQuantity(quantity, limits) : quantity

  // Before a choice, variants with different prices show the lowest final price ("From …");
  // variants that all cost the same show that price (with its discount) as usual.
  const priceRange = isConfigurable ? variantPriceRange(product) : null
  const showFrom = needsChoice && priceRange.min !== priceRange.max
  const priced = needsChoice ? (showFrom ? { ...product, price: priceRange.min, discountPercentage: 0 } : withVariant(product, product.variants[0])) : purchasable
  const { hasDiscount, roundedDiscount, salePrice, originalPrice } = getProductPricing(priced)
  // Phase 16: photos of the chosen colour (or value) first, then the shared ones.
  const gallery = product.images.length > 0 ? galleryOrder(product, selection) : null
  const images = gallery ? gallery.indexes.map((index) => product.images[index]) : [product.thumbnail]
  const imageAlts = gallery && product.imageAlts ? gallery.indexes.map((index) => product.imageAlts[index]) : undefined
  const imageVariants = gallery ? gallery.indexes.map((index) => product.imageVariants?.[index] ?? null) : [product.thumbnailVariants ?? null]
  // The category's real name from the tree (BuyNest's API), or the slug made readable.
  const category = categories?.find((candidate) => candidate.slug === product.category)
  const categoryName = product.category ? (category?.name ?? product.categoryName ?? formatSlug(product.category)) : null
  const parentCategories = category && categories ? categoryAncestors(categories, category.slug) : []

  // location.key is "default" when this page was the first one loaded
  // (e.g. opened from a bookmark), so there's no in-app page to go back to.
  const canGoBack = location.key !== 'default'

  const breadcrumbs = [
    { label: t('details.home'), to: ROUTES.home },
    ...parentCategories.map((parent) => ({ label: parent.name, to: ROUTES.category(parent.slug) })),
    ...(product.category ? [{ label: categoryName, to: ROUTES.category(product.category) }] : []),
    { label: product.title },
  ]

  const specifications = [
    [t('details.spec.brand'), product.brand],
    [t('details.spec.category'), categoryName],
    [t('details.spec.sku'), purchasable.sku],
    [t('details.spec.warranty'), product.warrantyInformation],
    [t('details.spec.shipping'), product.shippingInformation],
    [t('details.spec.returns'), product.returnPolicy],
    [t('details.spec.minimum'), minQuantity > 1 ? t('details.units', { count: minQuantity }) : null],
  ].filter(([, value]) => value) // only show what the API actually provided

  function handleAddToCart() {
    if (needsChoice) {
      // Phase 16: say what is missing and go to the first missing option; nothing reaches the cart.
      const missing = product.options.filter((option) => selection[option.id] === undefined)
      // Every option chosen but no variant (can't happen with the selector's rules): ask for the last one again.
      const asked = missing.length > 0 ? missing : product.options.slice(-1)
      setOptionErrors(Object.fromEntries(asked.map((option) => [option.id, t('details.pleaseSelect', { option: option.name })])))
      const group = optionsRef.current?.querySelector(`[data-option-id="${asked[0].id}"]`)
      const target = group?.querySelector('input:checked:not(:disabled)') ?? group?.querySelector('input:not(:disabled)')
      target?.focus()
      return
    }
    addItem(purchasable, shownQuantity)
  }

  function handleOptionChange(optionId, valueId) {
    // With BuyNest's API a sold-out variant can be chosen too, to ask for a stock alert.
    setSelection((current) => chooseValue(product, current, optionId, valueId, { soldOut: REAL_SHOP }))
    setOptionErrors((current) => {
      if (!(optionId in current)) return current
      const next = { ...current }
      delete next[optionId]
      return next
    })
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
            <LuArrowLeft aria-hidden="true" /> {t('details.back')}
          </button>
        ) : null}
        <Breadcrumb items={breadcrumbs} />
      </div>

      <div className="product-details__main">
        {/* key: a new set of photos (a colour with its own) starts at its first photo. */}
        <ProductGallery
          key={gallery?.valueId ?? 'all'}
          images={images}
          title={product.title}
          alts={imageAlts}
          variants={imageVariants}
        />

        <div className="product-details__info">
          {product.brand && <p className="product-details__brand">{product.brand}</p>}
          {/* Phase 13: a name the store hasn't translated yet is marked as English for screen readers. */}
          <h1 className="product-details__title" lang={product.contentLocale && product.contentLocale !== i18n.language ? product.contentLocale : undefined}>
            {product.title}
          </h1>
          {/* Phase 13: the Bangla short description (BuyNest's API, in Bangla only). */}
          {product.translatedShortDescription && <p className="product-details__lead">{toDescription(product.translatedShortDescription, 1000)}</p>}

          {product.rating !== null && (
            <a href="#reviews" className="product-details__rating">
              <RatingStars rating={product.rating} />
              <span>{t('details.reviewsCount', { count: product.reviews.length })}</span>
            </a>
          )}

          {isGiftCard ? (
            <>
              {product.description && <p className="product-details__description">{product.description}</p>}
              <GiftCardForm product={product} onAdd={(purchasable) => addItem(purchasable, 1)} />
            </>
          ) : (
          <>
          <div className="product-details__price">
            <span className="product-details__price-current">
              {showFrom && <span className="product-details__price-from">{t('details.from')}</span>}
              {formatPrice(salePrice)}
            </span>
            {hasDiscount && (
              <>
                <s className="product-details__price-original">
                  <span className="visually-hidden">{t('details.originalPrice')}</span>
                  {formatPrice(originalPrice)}
                </s>
                <ProductBadge variant="sale">{t('details.save', { percent: roundedDiscount })}</ProductBadge>
                {/* Phase 7: the store-wide sale (catalog price rule) behind this price. */}
                {product.priceRule && <span className="product-details__price-rule">{product.priceRule.name}</span>}
              </>
            )}
          </div>

          {/* Live region: the stock line appears once a full choice is made (phase 16: hidden before). */}
          <div aria-live="polite">{!needsChoice && <StockStatus product={purchasable} canBuy={canBuy} />}</div>

          {product.description && <p className="product-details__description">{product.description}</p>}

          {isConfigurable && (
            <div ref={optionsRef}>
              <VariantSelector product={product} selection={selection} onChange={handleOptionChange} allowSoldOut={REAL_SHOP} errors={optionErrors} />
            </div>
          )}

          <div className="product-details__purchase">
            {canBuy && (
              <QuantitySelector value={shownQuantity} min={minQuantity} max={purchasable.stock} onChange={setQuantity} />
            )}
            <Button
              size="lg"
              onClick={handleAddToCart}
              // Phase 16: enabled before a full choice; a click says which option is missing.
              disabled={!canBuy && !needsChoice}
              className="product-details__add"
            >
              <LuShoppingBag aria-hidden="true" />
              {t(canBuy || needsChoice ? 'details.addToCart' : 'details.unavailable')}
            </Button>
            <WishlistButton product={product} variant="button" />
            {/* Phase 11: add to the compare list (max 4). */}
            <CompareButton product={product} variant="button" />
          </div>
          {/* Phase 11: reward points this purchase would earn (signed in, when the store has points on). */}
          {isAuthenticated && settings.rewards && !needsChoice && earnEstimate(salePrice, settings.rewards) > 0 && (
            <p className="product-details__note product-details__points">{t('details.earnPoints', { points: earnEstimate(salePrice, settings.rewards) })}</p>
          )}
          {canBuy && minQuantity > 1 && (
            <p className="product-details__note">{t('details.minimumQuantity', { count: minQuantity })}</p>
          )}
          {/* key: a new form (and message) for each variant. */}
          {REAL_SHOP && isSoldOut && (
            <StockAlertForm key={variant?.id ?? 'product'} productId={product.id} variantId={variant?.id ?? null} variantLabel={variant ? purchasable.variantLabel : null} />
          )}
          </>
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

      {/* Phase 11: the admin's specifications table ("Screen size: 6.1 in"), when there are any. */}
      {product.specifications?.length > 0 && <SpecificationsTable rows={product.specifications} />}

      <section className="product-details__section" aria-labelledby="details-title">
        <h2 id="details-title">{t('details.productDetails')}</h2>
        <dl className="product-details__specs">
          {specifications.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Phase 11: the admin's up-sells (BuyNest's API; the demo has none). */}
      {product.upsells?.length > 0 && <LinkedProducts id="upsells-title" title={t('details.upsells')} products={product.upsells} />}

      <section className="product-details__section" id="reviews" aria-labelledby="reviews-title">
        <h2 id="reviews-title">{t('details.customerReviews')}</h2>
        <ProductReviews reviews={product.reviews} reviewPhotoCount={product.reviewPhotoCount ?? 0} />
        {/* Writing reviews needs BuyNest's API and customer accounts. */}
        {REAL_SHOP && <ReviewForm productId={product.id} productTitle={product.title} />}
      </section>

      {/* Phase 11: BuyNest's API answers the related products itself (the admin's links, or the same
          automatic choice as before); the demo keeps picking them from the category. */}
      {Array.isArray(product.related) ? (
        product.related.length > 0 && <LinkedProducts id="related-title" title={t('details.related')} products={product.related} />
      ) : (
        product.category && <RelatedProducts productId={product.id} categorySlug={product.category} categoryName={categoryName} />
      )}

      {/* Phase 11: what this browser opened before (not this product). */}
      <RecentlyViewed excludeId={product.id} className="product-details__section recently-viewed" />

    </div>
  )
}

function StockStatus({ product, canBuy }) {
  const { t } = useTranslation('catalog')
  if (product.stock === null) {
    return <p className="product-details__stock product-details__stock--out">{t('details.stockUnknown')}</p>
  }
  if (product.stock === 0) {
    return <p className="product-details__stock product-details__stock--out">{t('details.outOfStock')}</p>
  }
  if (!canBuy) {
    return (
      <p className="product-details__stock product-details__stock--out">
        {t('details.belowMinimum', { stock: product.stock, minimum: product.minimumOrderQuantity })}
      </p>
    )
  }
  if (product.availabilityStatus === 'Low Stock') {
    return <p className="product-details__stock product-details__stock--low">{t('details.lowStock', { stock: product.stock })}</p>
  }
  return <p className="product-details__stock">{t('details.inStock')}</p>
}

/** Phase 11: the product's specifications as a two-column table (row headers name each value). */
function SpecificationsTable({ rows }) {
  const { t } = useTranslation('catalog')
  return (
    <section className="product-details__section" aria-labelledby="specs-title">
      <h2 id="specs-title">{t('details.specifications')}</h2>
      <table className="product-details__spec-table">
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <td>{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

/** Phase 11: linked products from the API (up-sells, related), already chosen and ordered by the server. */
function LinkedProducts({ id, title, products }) {
  return (
    <section className="product-details__section" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      <ProductGrid products={products} />
    </section>
  )
}

/** Other products from the same category (server-side category request). */
function RelatedProducts({ productId, categorySlug, categoryName }) {
  const { t } = useTranslation('catalog')
  const request = useQuery(relatedProductsQuery(categorySlug, RELATED_LIMIT))
  const related = (request.data ?? []).filter((item) => item.id !== productId).slice(0, RELATED_LIMIT)

  if (request.error || (!request.isPending && related.length === 0)) return null

  return (
    <section className="product-details__section" aria-labelledby="related-title">
      <div className="product-details__section-header">
        <h2 id="related-title">{t('details.moreIn', { category: categoryName })}</h2>
        <Link to={ROUTES.category(categorySlug)}>{t('details.viewAll')}</Link>
      </div>
      {request.isPending ? <ProductGridSkeleton count={RELATED_LIMIT} /> : <ProductGrid products={related} />}
    </section>
  )
}

export default ProductDetailsPage

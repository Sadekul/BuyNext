import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { LuHeart, LuShoppingBag } from 'react-icons/lu'
import PageMeta from '../components/common/PageMeta'
import RatingStars from '../components/product/RatingStars'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import ErrorMessage from '../components/ui/ErrorMessage'
import Loader from '../components/ui/Loader'
import { useCart } from '../hooks/useCart'
import { getSharedWishlist } from '../services/wishlistService'
import { ROUTES } from '../constants/routes'
import { formatPrice } from '../utils/formatters'
import { getProductPricing } from '../utils/pricing'
import { getPurchaseLimits } from '../utils/inventory'
import { isGiftCardProduct } from '../utils/giftCards'
import './WishlistPage.css'

const isToken = (value) => /^[A-Za-z0-9_-]{16,128}$/.test(value ?? '')

/** Products with options (and gift cards) are chosen on their page; the rest can go straight into the cart. */
const choosesOnPage = (product) => product.hasVariants || isGiftCardProduct(product)
const canAdd = (product) => !choosesOnPage(product) && getPurchaseLimits(product).canBuy

/**
 * /wishlist/shared/:token (phase 11 §1, REAL_SHOP): a wishlist someone
 * shared. No sign-in needed; shows the owner's first name and their saved
 * products (with their notes), each with "Add to cart", plus "Add all to cart".
 * Unknown or stopped links get a friendly "not found". Kept out of search engines.
 */
function SharedWishlistPage() {
  const { token } = useParams()
  const valid = isToken(token)
  const request = useQuery({
    queryKey: ['shared-wishlist', token],
    queryFn: ({ signal }) => getSharedWishlist(token, { signal }),
    enabled: valid,
    retry: false,
    staleTime: 60_000,
  })

  if (valid && request.isPending) {
    return (
      <div className="section container">
        <Loader label="Loading wishlist…" />
      </div>
    )
  }

  if (!valid || request.error?.status === 404) {
    return (
      <div className="section container">
        <PageMeta title="Wishlist not found" noindex />
        <EmptyState icon={LuHeart} titleAs="h1" title="This wishlist link doesn't work" message="It may have been turned off or replaced with a new link. Ask the person who shared it for the latest link.">
          <Button to={ROUTES.products}>Browse products</Button>
        </EmptyState>
      </div>
    )
  }

  if (request.error) {
    return (
      <div className="section container">
        <ErrorMessage titleAs="h1" title="We couldn't load this wishlist" message={request.error.message} onRetry={() => request.refetch()} />
      </div>
    )
  }

  return <SharedWishlist wishlist={request.data} />
}

function SharedWishlist({ wishlist }) {
  const { addItem } = useCart()
  const [status, setStatus] = useState('')
  const title = wishlist.ownerFirstName ? `${wishlist.ownerFirstName}'s wishlist` : 'A shared wishlist'
  const addable = wishlist.items.filter((item) => canAdd(item.product))

  function addAll() {
    for (const item of addable) addItem(item.product)
    setStatus(`${addable.length} ${addable.length === 1 ? 'product was' : 'products were'} added to your cart.`)
  }

  return (
    <div className="wishlist-page section container">
      <PageMeta title={title} noindex />
      <header className="wishlist-page__header">
        <div>
          <h1>{title}</h1>
          <p className="wishlist-page__status">
            {wishlist.items.length} saved {wishlist.items.length === 1 ? 'product' : 'products'}
          </p>
        </div>
        {addable.length > 0 && (
          <Button onClick={addAll}>
            <LuShoppingBag aria-hidden="true" />
            Add all to cart
          </Button>
        )}
      </header>
      <p className="visually-hidden" role="status">
        {status}
      </p>

      {wishlist.items.length === 0 ? (
        <EmptyState icon={LuHeart} title="Nothing here yet" message="This wishlist has no products right now." />
      ) : (
        <ul className="wishlist-page__grid">
          {wishlist.items.map((item) => (
            <li key={`${item.product.id}-${item.variantLabel ?? ''}`}>
              <SharedItem item={item} onAdd={(product) => {
                addItem(product)
                setStatus(`${product.title} was added to your cart.`)
              }} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SharedItem({ item, onAdd }) {
  const { product } = item
  const { salePrice, originalPrice, hasDiscount } = getProductPricing(product)
  const { canBuy } = getPurchaseLimits(product)

  return (
    <article className="wishlist-item">
      <Link to={ROUTES.productDetails(product.id)} className="wishlist-item__media" tabIndex={-1} aria-hidden="true">
        <img src={product.thumbnail} alt="" width="240" height="240" loading="lazy" />
      </Link>
      <div className="wishlist-item__body">
        {product.brand && <p className="wishlist-item__brand">{product.brand}</p>}
        <h2 className="wishlist-item__title">
          <Link to={ROUTES.productDetails(product.id)}>{product.title}</Link>
        </h2>
        {item.variantLabel && <p className="wishlist-item__variant">{item.variantLabel}</p>}
        {typeof product.rating === 'number' && <RatingStars rating={product.rating} />}
        <p className="wishlist-item__price">
          <strong>{formatPrice(salePrice)}</strong>
          {hasDiscount && <s>{formatPrice(originalPrice)}</s>}
        </p>
        <p className={canBuy || isGiftCardProduct(product) ? 'wishlist-item__stock' : 'wishlist-item__stock wishlist-item__stock--out'}>
          {canBuy || isGiftCardProduct(product) ? (product.availabilityStatus ?? 'In Stock') : 'Out of stock'}
        </p>
        {item.note && <p className="wishlist-item__shared-note">“{item.note}”</p>}
        <div className="wishlist-item__actions">
          {choosesOnPage(product) ? (
            <Button size="sm" to={ROUTES.productDetails(product.id)} aria-label={`Choose options for ${product.title}`}>
              Choose options
            </Button>
          ) : (
            <Button size="sm" onClick={() => onAdd(product)} disabled={!canBuy} aria-label={`Add ${product.title} to cart`}>
              <LuShoppingBag aria-hidden="true" />
              Add to cart
            </Button>
          )}
        </div>
      </div>
    </article>
  )
}

export default SharedWishlistPage

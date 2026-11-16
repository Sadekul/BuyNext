import { Link } from 'react-router'
import { LuHeart, LuShoppingBag, LuTrash2 } from 'react-icons/lu'
import RatingStars from '../components/product/RatingStars'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import { useWishlist } from '../hooks/useWishlist'
import { useProductRefresh } from '../hooks/useProductRefresh'
import { ROUTES } from '../constants/routes'
import { SITE } from '../constants/site'
import { formatDate, formatPrice } from '../utils/formatters'
import { getPurchaseLimits } from '../utils/inventory'
import { getProductPricing } from '../utils/pricing'
import './WishlistPage.css'

function WishlistPage() {
  const wishlist = useWishlist()
  // Saved prices and stock can be weeks old: re-check once when the page opens.
  const refresh = useProductRefresh({
    hasItems: wishlist.items.length > 0,
    onProducts: wishlist.refreshProducts,
  })

  if (wishlist.count === 0) {
    return (
      <div className="section container">
        <title>{`Wishlist | ${SITE.name}`}</title>
        <EmptyState icon={LuHeart} title="Your wishlist is empty" message="Tap the heart on any product to save it for later.">
          <Button to={ROUTES.products}>Discover products</Button>
        </EmptyState>
      </div>
    )
  }

  return (
    <div className="wishlist-page section container">
      <title>{`Wishlist (${wishlist.count}) | ${SITE.name}`}</title>
      <header className="wishlist-page__header">
        <div>
          <h1>Wishlist</h1>
          <p className="wishlist-page__status" role="status">
            {refresh.isFetching
              ? 'Checking the latest prices and stock…'
              : `${wishlist.count} saved ${wishlist.count === 1 ? 'item' : 'items'}`}
          </p>
        </div>
        <Button variant="ghost" onClick={wishlist.clearWishlist}>
          Clear wishlist
        </Button>
      </header>

      <p className="wishlist-page__note">Saved on this device only. Signing in to sync your wishlist arrives with the real backend.</p>

      <ul className="wishlist-page__grid">
        {wishlist.items.map((item) => (
          <li key={item.productId}>
            <WishlistItem item={item} onMoveToCart={wishlist.moveToCart} onRemove={wishlist.removeItem} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function WishlistItem({ item, onMoveToCart, onRemove }) {
  const { salePrice, originalPrice, hasDiscount } = getProductPricing(item)
  const { canBuy } = getPurchaseLimits(item)
  const isAvailable = !item.isUnavailable && canBuy

  let availability = item.availabilityStatus ?? 'In Stock'
  if (item.isUnavailable) availability = 'No longer available'
  else if (!canBuy) availability = item.stock === 0 ? 'Out of stock' : 'Not enough stock for the minimum order'

  return (
    <article className="wishlist-item">
      <Link to={ROUTES.productDetails(item.productId)} className="wishlist-item__media" tabIndex={-1} aria-hidden="true">
        <img src={item.thumbnail} alt="" width="240" height="240" loading="lazy" />
      </Link>
      <div className="wishlist-item__body">
        {item.brand && <p className="wishlist-item__brand">{item.brand}</p>}
        <h2 className="wishlist-item__title">
          <Link to={ROUTES.productDetails(item.productId)}>{item.title}</Link>
        </h2>
        {item.rating !== null && <RatingStars rating={item.rating} />}
        <p className="wishlist-item__price">
          <strong>{formatPrice(salePrice)}</strong>
          {hasDiscount && <s>{formatPrice(originalPrice)}</s>}
        </p>
        <p className={isAvailable ? 'wishlist-item__stock' : 'wishlist-item__stock wishlist-item__stock--out'}>
          {availability}
        </p>
        {item.addedAt && <p className="wishlist-item__date">Saved {formatDate(new Date(item.addedAt).toISOString())}</p>}

        <div className="wishlist-item__actions">
          {item.hasVariants && !item.isUnavailable ? (
            // Options (size, color) are chosen on the product page.
            <Button size="sm" to={ROUTES.productDetails(item.productId)} aria-label={`Choose options for ${item.title}`}>
              Choose options
            </Button>
          ) : (
            <Button size="sm" onClick={() => onMoveToCart(item)} disabled={!isAvailable}>
              <LuShoppingBag aria-hidden="true" />
              Move to cart
            </Button>
          )}
          <button
            type="button"
            className="wishlist-item__remove"
            onClick={() => onRemove(item.productId)}
            aria-label={`Remove ${item.title} from wishlist`}
          >
            <LuTrash2 aria-hidden="true" />
          </button>
        </div>
      </div>
    </article>
  )
}

export default WishlistPage

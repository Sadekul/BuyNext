import { useId, useState } from 'react'
import { Link } from 'react-router'
import { LuHeart, LuShoppingBag, LuTrash2 } from 'react-icons/lu'
import RatingStars from '../components/product/RatingStars'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import ShareWishlist from '../components/wishlist/ShareWishlist'
import { useWishlist } from '../hooks/useWishlist'
import { useProductRefresh } from '../hooks/useProductRefresh'
import { ROUTES } from '../constants/routes'
import { SITE } from '../constants/site'
import { REAL_SHOP } from '../constants/shop'
import { MAX_NOTE_LENGTH } from '../reducers/wishlistReducer'
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

      <p className="wishlist-page__note">{storageNote(wishlist.onServer)}</p>

      {/* Phase 11: a link others can open (BuyNest's API, signed in; not in the demo). */}
      {wishlist.onServer && <ShareWishlist />}

      <ul className="wishlist-page__grid">
        {wishlist.items.map((item) => (
          <li key={item.productId}>
            <WishlistItem item={item} onMoveToCart={wishlist.moveToCart} onRemove={wishlist.removeItem} onSaveNote={wishlist.onServer ? wishlist.setNote : null} />
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Where the list is kept, in the shopper's words. */
function storageNote(onServer) {
  if (onServer) return 'Saved to your account, so it follows you to any device where you sign in.'
  if (REAL_SHOP) return 'Saved on this device. Sign in to keep your wishlist in your account and share it.'
  return 'Saved on this device only. Signing in to sync your wishlist arrives with the real backend.'
}

function WishlistItem({ item, onMoveToCart, onRemove, onSaveNote }) {
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
        {item.variantLabel && <p className="wishlist-item__variant">{item.variantLabel}</p>}
        {item.rating !== null && <RatingStars rating={item.rating} />}
        <p className="wishlist-item__price">
          <strong>{formatPrice(salePrice)}</strong>
          {hasDiscount && <s>{formatPrice(originalPrice)}</s>}
        </p>
        <p className={isAvailable ? 'wishlist-item__stock' : 'wishlist-item__stock wishlist-item__stock--out'}>
          {availability}
        </p>
        {item.addedAt && <p className="wishlist-item__date">Saved {formatDate(new Date(item.addedAt).toISOString())}</p>}
        {/* Phase 11: a note for yourself (or whoever you share the list with). */}
        {onSaveNote && <NoteEditor item={item} onSave={onSaveNote} />}

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

/** Phase 11: the item's note (up to 255 characters), saved with the server wishlist. */
function NoteEditor({ item, onSave }) {
  const [draft, setDraft] = useState(item.note ?? '')
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)
  const inputId = useId()
  const changed = draft.trim() !== (item.note ?? '')

  async function handleSubmit(event) {
    event.preventDefault()
    if (!changed) return
    setSaving(true)
    setStatus('')
    const saved = await onSave(item.productId, draft)
    setSaving(false)
    setStatus(saved ? (draft.trim() ? 'Note saved.' : 'Note removed.') : '')
  }

  return (
    <form className="wishlist-item__note" onSubmit={handleSubmit}>
      <label htmlFor={inputId}>Note</label>
      <div className="wishlist-item__note-row">
        <input
          id={inputId}
          value={draft}
          maxLength={MAX_NOTE_LENGTH}
          placeholder="e.g. size M, for Sam's birthday"
          onChange={(event) => {
            setDraft(event.target.value)
            setStatus('')
          }}
        />
        <Button type="submit" size="sm" variant="outline" disabled={!changed || saving} aria-label={`Save note for ${item.title}`}>
          Save
        </Button>
      </div>
      <p className="wishlist-item__note-status" role="status">
        {status}
      </p>
    </form>
  )
}

export default WishlistPage

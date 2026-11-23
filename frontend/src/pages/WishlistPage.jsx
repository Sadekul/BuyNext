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
import { useTranslation } from 'react-i18next'
import { translate } from '../i18n'
import { availabilityLabel } from '../utils/catalogText'

function WishlistPage() {
  const { t } = useTranslation('catalog')
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
        <EmptyState icon={LuHeart} title={t('wishlistPage.emptyTitle')} message={t('wishlistPage.emptyMessage')}>
          <Button to={ROUTES.products}>{t('wishlistPage.discover')}</Button>
        </EmptyState>
      </div>
    )
  }

  return (
    <div className="wishlist-page section container">
      <title>{`${t('wishlistPage.tabTitle', { count: wishlist.count })} | ${SITE.name}`}</title>
      <header className="wishlist-page__header">
        <div>
          <h1>{t('wishlistPage.title')}</h1>
          <p className="wishlist-page__status" role="status">
            {refresh.isFetching
              ? t('wishlistPage.checking')
              : t('wishlistPage.saved', { count: wishlist.count })}
          </p>
        </div>
        <Button variant="ghost" onClick={wishlist.clearWishlist}>
          {t('wishlistPage.clear')}
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
  if (onServer) return translate('catalog:wishlistPage.noteAccount')
  if (REAL_SHOP) return translate('catalog:wishlistPage.noteDevice')
  return translate('catalog:wishlistPage.noteDemo')
}

function WishlistItem({ item, onMoveToCart, onRemove, onSaveNote }) {
  const { t } = useTranslation('catalog')
  const { salePrice, originalPrice, hasDiscount } = getProductPricing(item)
  const { canBuy } = getPurchaseLimits(item)
  const isAvailable = !item.isUnavailable && canBuy

  let availability = availabilityLabel(item.availabilityStatus ?? 'In Stock')
  if (item.isUnavailable) availability = t('wishlistPage.gone')
  else if (!canBuy) availability = t(item.stock === 0 ? 'wishlistPage.outOfStock' : 'wishlistPage.notEnough')

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
        {item.addedAt && <p className="wishlist-item__date">{t('wishlistPage.savedOn', { date: formatDate(new Date(item.addedAt).toISOString()) })}</p>}
        {/* Phase 11: a note for yourself (or whoever you share the list with). */}
        {onSaveNote && <NoteEditor item={item} onSave={onSaveNote} />}

        <div className="wishlist-item__actions">
          {item.hasVariants && !item.isUnavailable ? (
            // Options (size, color) are chosen on the product page.
            <Button size="sm" to={ROUTES.productDetails(item.productId)} aria-label={t('wishlistPage.chooseOptionsFor', { title: item.title })}>
              {t('wishlistPage.chooseOptions')}
            </Button>
          ) : (
            <Button size="sm" onClick={() => onMoveToCart(item)} disabled={!isAvailable}>
              <LuShoppingBag aria-hidden="true" />
              {t('wishlistPage.moveToCart')}
            </Button>
          )}
          <button
            type="button"
            className="wishlist-item__remove"
            onClick={() => onRemove(item.productId)}
            aria-label={t('wishlistPage.remove', { title: item.title })}
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
  const { t } = useTranslation('catalog')
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
    setStatus(saved ? t(draft.trim() ? 'wishlistPage.noteSaved' : 'wishlistPage.noteRemoved') : '')
  }

  return (
    <form className="wishlist-item__note" onSubmit={handleSubmit}>
      <label htmlFor={inputId}>{t('wishlistPage.note')}</label>
      <div className="wishlist-item__note-row">
        <input
          id={inputId}
          value={draft}
          maxLength={MAX_NOTE_LENGTH}
          placeholder={t('wishlistPage.notePlaceholder')}
          onChange={(event) => {
            setDraft(event.target.value)
            setStatus('')
          }}
        />
        <Button type="submit" size="sm" variant="outline" disabled={!changed || saving} aria-label={t('wishlistPage.saveNoteFor', { title: item.title })}>
          {t('wishlistPage.save')}
        </Button>
      </div>
      <p className="wishlist-item__note-status" role="status">
        {status}
      </p>
    </form>
  )
}

export default WishlistPage

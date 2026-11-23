import { LuHeart } from 'react-icons/lu'
import { useWishlist } from '../../hooks/useWishlist'
import { cn } from '../../utils/classNames'
import './WishlistButton.css'
import { useTranslation } from 'react-i18next'

/**
 * Heart toggle connected directly to the wishlist context. Because it reads
 * the context itself, any component can render it without threading
 * `isWishlisted` / `onToggle` props through every layer (no prop drilling).
 *
 * Variants: "icon" (round, used on cards) or "button" (outlined, product page).
 */
function WishlistButton({ product, variant = 'icon', className }) {
  const { t } = useTranslation('catalog')
  const { isInWishlist, toggleItem } = useWishlist()
  const isSaved = isInWishlist(product.id)

  return (
    <button
      type="button"
      className={cn('wishlist-button', `wishlist-button--${variant}`, isSaved && 'wishlist-button--saved', className)}
      onClick={() => toggleItem(product)}
      aria-pressed={isSaved}
      aria-label={t(isSaved ? 'wishlistButton.remove' : 'wishlistButton.save', { title: product.title })}
      title={t(isSaved ? 'wishlistButton.savedTitle' : 'wishlistButton.saveTitle')}
    >
      <LuHeart aria-hidden="true" />
    </button>
  )
}

export default WishlistButton

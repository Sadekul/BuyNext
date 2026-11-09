import { useContext } from 'react'
import { WishlistContext } from '../context/wishlistContext'

/** Access the shared wishlist. Throws a clear error if used outside <WishlistProvider>. */
export function useWishlist() {
  const wishlist = useContext(WishlistContext)
  if (!wishlist) throw new Error('useWishlist() must be used inside <WishlistProvider>.')
  return wishlist
}

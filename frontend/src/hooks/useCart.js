import { useContext } from 'react'
import { CartContext } from '../context/cartContext'

/** Access the shared cart. Throws a clear error if used outside <CartProvider>. */
export function useCart() {
  const cart = useContext(CartContext)
  if (!cart) throw new Error('useCart() must be used inside <CartProvider>.')
  return cart
}

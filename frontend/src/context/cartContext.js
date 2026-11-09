import { createContext } from 'react'

/**
 * Cart context object. The value is provided by <CartProvider> and read
 * with the useCart() hook. `null` default = "used outside the provider".
 */
export const CartContext = createContext(null)

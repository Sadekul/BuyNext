# Phase 6 — Shopping cart

**Goal:** a practical cart shared by the whole app, saved across refreshes, with correct totals.

## What was built

| Feature | Where |
| --- | --- |
| Add / remove / increase / decrease / clear | `reducers/cartReducer.js` |
| Shared state for every page | `context/CartProvider.jsx` + `hooks/useCart.js` |
| Cart count badge, header button opens drawer | `components/layout/Header.jsx` |
| Cart drawer (opens on add) | `components/cart/CartDrawer.jsx` (Modal `drawer-right`) |
| Full cart page `/cart` | `pages/CartPage.jsx` |
| Line subtotal, cart subtotal, item count | `CartLineItem`, `utils/cartTotals.js` |
| Estimated shipping (configured) | `SHIPPING_RULES` in `constants/store.js` |
| Discount codes with explicit rules | `COUPONS` in `constants/store.js`, `evaluateCoupon` |
| Invalid quantities impossible | `getPurchaseLimits` + `clampQuantity` (min order ≤ qty ≤ stock) |
| Persistence, versioned and validated | `localStorage` key `buynest.cart.v1`, `sanitizeCart` |
| Sync between tabs | `storage` event listener |
| Unavailable products, price/stock changes | `useCartRefresh` → `cart/productsRefreshed` |

### Explicit pricing rules (demo values)

| Rule | Value |
| --- | --- |
| Free standard shipping | Order (after discount) ≥ $50 |
| Standard shipping | $4.99 |
| `NEST10` | 10% off the subtotal |
| `SAVE20` | $20 off when the subtotal is ≥ $150 |
| Taxes | Not estimated: "Calculated at checkout" |

## Data flow

```
ProductCard / QuickView / ProductDetails
        │ addItem(product, quantity)
        ▼
CartProvider ── dispatch({ type: 'cart/added', product, quantity }) ──▶ cartReducer
        │                                                               │ new state
        │◀──────────────────────────────────────────────────────────────┘
        ├─ useEffect → localStorage.setItem('buynest.cart.v1', …)
        ├─ value = { items, totals: calculateCartTotals(items, coupon), … }
        ▼
Header badge · CartDrawer · CartPage   (all read useCart())
```

## Concepts

### State lifting → global state
**Concept.** When distant components need the same data, move it up to their closest common parent. When that parent would be the whole app, use Context.
**BuyNest.** The header badge, the drawer, product cards on every page, and the cart page all need the cart. Passing it through props from `App` would mean *prop drilling* through layouts and pages that don't care about it.

### Props vs global state
Keep data in props when only a parent and its children need it (filters → `CatalogFilters`). Use global state for data many unrelated parts share (cart, wishlist, current user).

### Context API
`createContext` (in `context/cartContext.js`) → `<CartContext value={…}>` in `CartProvider` (React 19 lets the context itself act as the provider) → `useContext` inside `useCart()`. The hook throws a clear error when used outside the provider, which is a common bug.

### useReducer
**Why not `useState`?** The cart has many related transitions (add, change quantity, remove, apply coupon, refresh from the API) that all must respect the same rules. A reducer puts every transition in one pure, testable function:
```js
cartReducer(state, { type: 'cart/quantityChanged', productId: 121, quantity: 99 })
// → quantity clamped to the stock, never above
```
| `useState` | `useReducer` |
| --- | --- |
| A few independent values | Many related updates with rules |
| Logic inside event handlers | Logic in one pure function, easy to unit test (Phase 13) |

### Immutable updates
Every case returns new objects: `items.map(...)` to change one line, `items.filter(...)` to remove, `[...items, newItem]` to add. Mutating (`item.quantity++`) would keep the same reference, so React and `useMemo` wouldn't see the change.

### Custom hooks
`useCart()` (read the context safely), `useCartRefresh()` (re-check prices and stock when the cart page opens), and `useToast()` all hide details behind a small API.

### localStorage synchronization
- **Read once**, with the lazy initializer `useReducer(reducer, undefined, init)`, not on every render.
- **Write in an effect** after each change: `useEffect(() => writeJson(KEY, cart), [cart])`.
- **Validate on load** (`sanitizeCart`): storage can be edited or corrupted; bad entries are dropped. The browser test writes invalid JSON and checks that the app still starts with an empty cart.
- **Versioned key** (`.v1`) so a future shape change doesn't load incompatible data.
- **`storage` event** keeps other tabs in sync.

### Money in cents
`0.1 + 0.2 === 0.30000000000000004` in JavaScript. `utils/cartTotals.js` converts to integer cents, adds and multiplies, then converts back. Real backends store money as integers (cents) or decimals, never floats.

## Why the backend must re-validate everything
localStorage is a **convenience**, not a source of truth. Anyone can open DevTools and set a price to $0.01. The backend must, at checkout:
1. Look up the real price, discount, and stock for every product ID.
2. Validate coupon codes (and usage limits) on the server. The demo codes here are visible in the JavaScript bundle.
3. Calculate shipping and taxes from the real address.
4. Return the authoritative total; the frontend only displays it.

The cart page already shows the pattern: `useCartRefresh` fetches current data and the reducer flags changes ("Price updated", "Quantity reduced to 7: only 7 in stock", "This product is out of stock", "no longer available"). Checkout is blocked until unavailable items are removed.

## Verify it
1. Add the iPhone 13 Pro from a card → drawer opens, badge 1, subtotal $996.92.
2. Add the iPhone 5s → it adds 3 (its minimum order). In the drawer, "−" is disabled at 3.
3. Reload → the cart is still there. DevTools → Application → Local Storage → `buynest.cart.v1`.
4. `/cart`: apply `NEST10` (10% off), try `SAVE20` on a small order ("Spend at least $150"), see $4.99 shipping under $50.
5. Open a second tab and add an item → the first tab's badge updates.
6. In DevTools, edit a stored item's `price` or set `quantity` to 9999, then open `/cart` → the refresh corrects it and explains why.

## Common errors
- **"useCart() must be used inside `<CartProvider>`":** the component is rendered outside `App`'s provider (often in a test; Phase 13 wraps tests in providers).
- **Cart resets on refresh:** reading storage in an effect after the first render overwrote it; use the lazy initializer.
- **Totals off by a cent:** floating-point math; calculate in cents.
- **Every consumer re-renders constantly:** the context value is a new object each render; memoize it (`useMemo`) and the functions (`useCallback`).

## Practice
Add a rule "free shipping for 3 or more items, regardless of value" to `calculateCartTotals`, and show it in `FreeShippingProgress`.

## Interview questions
1. **When would you choose `useReducer` over `useState`?** Several related updates with shared rules, or when the next state depends on complex logic; also for easy unit testing.
2. **What problem does Context solve, and what's its cost?** It avoids prop drilling; every consumer re-renders when the value changes, so keep values stable and split contexts if needed (Phase 11).
3. **Why calculate money in integer cents?** Binary floating point can't represent most decimal fractions exactly.
4. **Is a localStorage cart secure?** No. It's user-editable; prices and totals must be recalculated on the server.

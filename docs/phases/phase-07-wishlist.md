# Phase 7 — Wishlist

**Goal:** let shoppers save products for later, on any page, and move them to the cart.

## What was built

| Feature | Where |
| --- | --- |
| Add / remove (heart toggle) on every product card and the details page | `components/product/WishlistButton.jsx` |
| Icon state (filled heart, `aria-pressed`) | `WishlistButton` reads `isInWishlist(id)` |
| Wishlist count in the header | `Header` → `useWishlist().count` |
| Wishlist page `/wishlist` | `pages/WishlistPage.jsx` |
| No duplicates | `wishlistReducer` (`ADDED` ignores saved IDs) + `sanitizeWishlist` (removes duplicates from storage) |
| Saved locally, synced across tabs | `usePersistentReducer` (`buynest.wishlist.v1`) |
| Move to cart | `moveToCart(item)` in `WishlistProvider` (adds at minimum order quantity, removes from wishlist) |
| Fresh prices and availability | `useProductRefresh('wishlist', …)` → `wishlist/productsRefreshed` |

## Reusable hooks

Phase 6 wrote "reducer + localStorage + cross-tab sync" inside `CartProvider`. The wishlist needs exactly the same thing, so it became a hook:

```js
// hooks/usePersistentReducer.js
const [state, dispatch] = usePersistentReducer(wishlistReducer, {
  storageKey: 'buynest.wishlist.v1',
  emptyState: EMPTY_WISHLIST,
  sanitize: sanitizeWishlist,
  replaceActionType: WISHLIST_ACTIONS.REPLACED,
})
```

Likewise, `useCartRefresh` became `useProductRefresh(key, { hasItems, onProducts })`, used by both the cart and the wishlist page.

**When to extract a hook:** when two components need the same *stateful logic* (not just the same markup). The rule of thumb is to write it once, notice the second use, then extract. A hook shares logic, not state: each call has its own state.

## Shared state: "connected" components vs props

The heart appears on every product card: homepage sections, catalog, related products. Passing `isWishlisted` and `onToggleWishlist` through every `ProductGrid` and `ProductSection` would be prop drilling. Instead, `WishlistButton` calls `useWishlist()` itself:

```
WishlistProvider (state)
   │ context
   ├── Header (count)
   ├── WishlistButton ×N (on every ProductCard, details page)
   └── WishlistPage
```

| Approach | Good for | Cost |
| --- | --- | --- |
| Props (`onAddToCart`) | Behavior the parent should decide (cart vs quick view) | Threaded through layers |
| Context-connected component (`WishlistButton`) | The same behavior everywhere | The component only works inside the provider |

`ProductCard` still takes `onAddToCart` as a prop (the catalog closes Quick view first, the homepage doesn't), but owns the wishlist heart.

## Provider order
`WishlistProvider` is nested inside `CartProvider` in `App.jsx`, because `moveToCart` calls `useCart()`. A provider can only read contexts *above* it.

## Keeping the reducer pure
The "saved on" date needs `Date.now()`, which is impure (a different result every call). It's called in the `addItem` callback (an event) and passed in the action (`addedAt`), so the reducer stays a pure function.

## Syncing with an account later
This wishlist lives in one browser. With a real backend (Phase 12):
1. `GET /api/wishlist` after sign-in; `POST`/`DELETE /api/wishlist/{productId}` on toggle.
2. On sign-in, **merge**: send local items to the server, then replace local state with the server's list.
3. Keep localStorage only for signed-out visitors.

## Verify it
1. Click a heart on `/categories/smartphones` → it fills; the header shows "Wishlist, 1 items". Click again → removed.
2. Open the product page → its heart shows the same state.
3. `/wishlist` → newest first; the sold-out Galaxy S8 has "Move to cart" disabled.
4. "Move to cart" on the iPhone 5s → the cart drawer opens with 3 (minimum order); the item leaves the wishlist.
5. Reload → still saved. Save in a second tab → the first tab's count updates.

## Practice
Add "Move all available to cart" to the wishlist page. Which provider function should it call, and how do you skip unavailable items?

## Interview questions
1. **What do custom hooks share between components: state or logic?** Logic only; each call gets its own state.
2. **When is reading context inside a small component better than passing props?** When the same data/behavior is needed in many places at different depths.
3. **Why must reducers be pure?** React may call them more than once (e.g. StrictMode); impure reducers give inconsistent state and can't be tested reliably.
4. **How would you merge a guest wishlist with a logged-in user's wishlist?** Upload local items after login, let the server de-duplicate, then use the server list as the source of truth.

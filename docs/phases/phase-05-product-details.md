# Phase 5 — Product details page

**Goal:** a dynamic page per product at `/products/:productId`, driven by the URL.

## What was built

| Feature | Where |
| --- | --- |
| Route `/products/:productId` | `routes/AppRoutes.jsx` → `pages/ProductDetailsPage.jsx` |
| Fetch by ID, 404 → "Product not found" (also for `/products/abc`, without a request) | `ProductDetailsPage` |
| Gallery: main image + thumbnails | `components/product/ProductGallery.jsx` |
| Brand, title, rating, review count, sale/original price, "Save X%" | `ProductDetails` |
| Stock status, incl. "below minimum order" | `StockStatus` |
| Quantity selector limited to [minimum order, stock] | `components/product/QuantitySelector.jsx` (reused by the cart in Phase 6) |
| Add to cart / wishlist | Reports the action; real behavior in Phases 6–7 |
| Specifications (only fields the API provides) | `<dl>` in `ProductDetails` |
| Reviews (name, date, rating, comment; emails dropped) | `components/product/ProductReviews.jsx` |
| Related products (same category) | `RelatedProducts` → `GET /products/category/:slug?limit=5` |
| Breadcrumb, Back button, page `<title>` | `components/common/Breadcrumb.jsx`, `useNavigate(-1)` |

## Variants: why there's no size/color picker

DummyJSON products have **no variants**: no sizes, colors, or per-variant stock or prices. Inventing them would mislead shoppers and break at checkout, so BuyNest doesn't.

A real variant API needs, per product:

```json
{
  "id": 501,
  "title": "Trail Runner Shoe",
  "options": [
    { "name": "Size", "values": ["40", "41", "42"] },
    { "name": "Color", "values": ["Black", "Red"] }
  ],
  "variants": [
    { "id": 9001, "sku": "TRS-40-BLK", "options": { "Size": "40", "Color": "Black" },
      "price": 89.99, "stock": 12, "image": "…/black.webp" },
    { "id": 9002, "sku": "TRS-40-RED", "options": { "Size": "40", "Color": "Red" },
      "price": 89.99, "stock": 0, "image": "…/red.webp" }
  ]
}
```

- **Options** describe the choices; **variants** are the actual purchasable combinations, each with its own SKU, price, stock, and image.
- The cart stores the **variant ID**, not the product ID.
- The UI disables combinations whose variant is missing or out of stock.
- Shopify (`product.variants`, `selectedOptions`) and Magento (configurable products with child simple products) both work this way. Laravel would model it as `products` → `product_variants` → `variant_option_values`.

## React Router concepts

### Dynamic routes and `useParams`
`<Route path="products/:productId" />` matches `/products/1`, `/products/123`, and so on. `useParams()` returns `{ productId: '123' }`. URL parameters are always **strings**, so we validate with `/^\d+$/` before requesting.

### Route-based data fetching
`useFetch(\`product:${productId}\`, …)`: the URL decides the request key, so a new `:productId` fetches a new product and cancels the old request (`AbortController`).

### Component lifecycle during navigation
Going from `/products/123` to `/products/121` does **not** unmount the page: it is the same `<Route>`, so React reuses the component and keeps its state. Without a fix, the gallery would stay on "image 2" and the quantity on "5". We render `<ProductDetails key={product.id} />`; a new key means a fresh component with fresh state. The browser test checks this (quantity 5 → resets to the new product's minimum, 3).

### `Link`, `NavLink`, and `useNavigate`
- `Link` for normal navigation (breadcrumb, related products).
- `NavLink` when the link must know whether it's active (main nav, category chips).
- `useNavigate()` for navigation in code: `navigate(-1)` is the Back button. We only show it when `location.key !== 'default'`, meaning there is an in-app page to go back to. On a fresh tab, Back would leave the site.

### URL search parameters
Used on the catalog for `?q=` and `?sort=` (`useSearchParams`). Phase 8 moves the filters there too.

## Business rules taken from real data
- **Minimum order quantity** (`minimumOrderQuantity`, 1–48 in DummyJSON): the selector starts at it and can't go below it. 21 products have a minimum above their stock, so they are shown as unavailable rather than letting shoppers add an amount that can't be fulfilled.
- **Weight and dimensions are not shown**: the API gives numbers without units.
- **Reviewer emails are removed** in the adapter (privacy: the storefront never needs them).

## Verify it
1. `/products/123` → title "iPhone 13 Pro | BuyNest", breadcrumb Home › Smartphones › iPhone 13 Pro, 3 thumbnails, 3 reviews.
2. Click thumbnail 2 → main image changes. Quantity can't go below 1 or above the stock.
3. Raise the quantity to 5, click a related product → the quantity resets to that product's minimum; the page scrolls to the top; "Back" returns.
4. `/products/6` → quantity starts at 9 ("Minimum order quantity: 9"). `/products/20` → "Only 10 left — below the minimum order of 46", button disabled.
5. `/products/99999` and `/products/abc` → "Product not found".

## Common errors
- **Old product flashes or state carries over:** missing `key` on the per-product component.
- **`useParams()` value is a string:** compare with `String(id)` or convert with `Number()`.
- **Blank page on refresh in production:** the server must send `index.html` for every route (SPA fallback, Phase 14).

## Practice
Make the selected gallery image part of the URL (`?image=2`) using `useSearchParams`, so a shared link opens on the same image. Remember to clamp invalid values.

## Interview questions
1. **How do you read a route parameter, and what type is it?** `useParams()`; always a string (or `undefined`).
2. **Navigating between two URLs of the same route — does the component remount?** No, React reuses it. Use a `key` (or derive everything from props) to reset state.
3. **`Link` vs `useNavigate`?** `Link` renders an accessible anchor for user navigation; `useNavigate` is for navigation triggered by code (after a form submit, a Back button).
4. **Why not invent variants when the API has none?** The cart, stock, and checkout all depend on real variant IDs and inventory; fake ones would fail at payment.

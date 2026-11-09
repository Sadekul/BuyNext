# Phase 4 — Product listing and catalog

**Goal:** a real catalog page: filters, sorting, pagination, grid/list views, quick view.
**Routes:** `/products`, `/products?q=…`, `/categories/:slug`, `/deals`

## What was built

| Feature | Where | Server or client? |
| --- | --- | --- |
| Search (`?q=`) | `useCatalogProducts` → `/products/search` | Server |
| Category (`/categories/:slug`) | `useCatalogProducts` → `/products/category/:slug` | Server |
| Price range (sale price) | `CatalogFilters` + `filterProducts` | Client |
| Rating (4/3/2 & up) | same | Client |
| Brand (multi-select, with counts) | same, options from `getBrandOptions` | Client |
| In stock only | same | Client |
| Sort (price, rating, discount, name) | `sortProducts`, value kept in the URL | Client |
| Pagination (12 per page) | `paginate` + `Pagination` | Client |
| Grid / list layout | `ViewToggle`, `ProductCard layout="list"` | — |
| Quick view | `QuickViewModal` → `GET /products/:id` | Server (one product) |
| Add to cart / wishlist | Function props; real behavior in Phases 6–7 | — |

## Key decision: server-side vs client-side filtering

**Concept.** *Server-side* filtering means the API returns only matching products. *Client-side* filtering means the browser downloads a set of products and filters them in JavaScript.

**Why it matters.** Filtering only the 12 products on screen gives wrong answers ("no Samsung phones" when they're on page 2). Filters must see the whole set.

**What we did.** DummyJSON can search and list one category, but has no price/rating/brand parameters. So the server narrows the *scope* (search or category), we download that whole scope (at most 194 products, card fields only), then filter → sort → paginate in the browser.

```
URL (?q / :slug) ──▶ server: which products        ──▶ products[]
filters (state)  ──▶ filterProducts(products, filters)
sort (URL)       ──▶ sortProducts(filtered, sort)
page (state)     ──▶ paginate(sorted, page, 12)    ──▶ <ProductGrid />
```

**Alternatives.** With a real backend (Laravel), send everything as query parameters, e.g. `GET /api/products?category=phones&price_min=100&brand[]=Apple&sort=price&page=2`. The server filters with SQL and returns one page plus a total. That is the only approach that scales to large catalogs. Because filtering lives in `utils/catalog.js` and data access in services/hooks, switching later only changes the hook, not the components.

**Phase 3 → Phase 4 change.** Phase 3 used server pagination with "Load more" (`useProductList`). Client-side filters need the full scope, so that hook was replaced by `useCatalogProducts` + numbered pages. It is still in Git history (commit `62cb59f`) if you want to compare.

## React concepts in this phase

### Derived state
**Concept.** Values you can calculate from existing state/props should be calculated during render, not stored in more state.
**BuyNest.** In `Catalog` (`pages/ProductListingPage.jsx`) only `filters`, `page`, `layout`, and `quickViewProduct` are state. `visibleProducts`, `brandOptions`, `pagination`, and `activeFilterCount` are recalculated on every render.
**Why.** Two copies of the same truth drift apart (e.g. a stored `filteredProducts` that forgot to update after sorting). Phase 8 adds `useMemo` where the calculation is worth caching.

### Controlled inputs
Every filter input gets its `value`/`checked` from `filters` and reports changes through `onChange(nextFilters)`. `CatalogFilters` never owns the data; the parent does. This is why "Clear all" can reset every input at once.

### Immutable updates
```js
// ✗ mutates state — React may not re-render
filters.brands.push('Apple')
// ✓ new objects/arrays
onChange({ ...filters, brands: [...filters.brands, 'Apple'] })
```
`sortProducts` uses `toSorted()` (returns a new array). `Array.prototype.sort()` sorts in place and would mutate the API data.

### Resetting state with `key`
`<Catalog key={scopeKey} … />` — when the search or category changes, the key changes, so React discards the old `Catalog` (and its filters, page, and layout) and mounts a fresh one. No reset effect needed. Brand options differ per category, so a reset is the right behavior.

### Array methods
`filter()` (filters), `map()` (rendering, brand counts), `toSorted()` with comparators, `slice()` (pagination), `Set`/`Map` for fast lookups.

### Component communication
```
Catalog (state owner)
 ├─ CatalogFilters  ── onChange(filters) ──▶ Catalog
 ├─ SortSelect      ── onChange(value)   ──▶ Catalog ──▶ ProductListingPage (URL)
 ├─ ViewToggle      ── onChange(layout)  ──▶ Catalog
 ├─ ProductGrid ─ ProductCard ── onQuickView(product) ──▶ Catalog ──▶ QuickViewModal
 └─ Pagination      ── onPageChange(n)   ──▶ Catalog
```

## Not fabricated
- Products without a `brand` (e.g. sports accessories) show no brand; the brand filter only appears when brands exist, and brandless products are hidden only while a brand is selected.
- No variant sizes or colors are invented (DummyJSON has none).
- Price filters use the sale price (what the shopper pays). The pricing assumption is documented in `utils/pricing.js`.

## Verify it
1. `/products` → "Showing 1–12 of 194 products", pages 1…17.
2. Set price $100–$500, sort "Price: low to high" → every price is within the range and ascending.
3. Choose "4 & up" → every card shows ≥ 4.0. "Clear all (3)" resets everything.
4. `/categories/smartphones` → brands Apple, Oppo, Realme, Samsung, Vivo with counts. Samsung + Vivo → 6 cards; "In stock only" → 5 (Galaxy S8 is sold out).
5. Switch to Laptops → filters reset.
6. List view shows category, availability, and "Save X%". Quick view loads the description from `GET /products/:id` (watch the Network tab).
7. On a phone width: the "Filters" button opens and closes the panel.

## Common errors
- **All filters return nothing:** check you compare numbers, not strings (`Number(value)`); `parsePriceBound` handles this.
- **"Each child should have a unique key":** use `product.id` (or `brand.name`), never the array index for real data.
- **List sorts itself unexpectedly:** something called `.sort()` on state; use `toSorted()`.

## Practice
Add a "Has discount" checkbox filter (`discountPercentage >= 1`). You need to touch `EMPTY_FILTERS`, `filterProducts`, `countActiveFilters`, and `CatalogFilters`.

## Interview questions
1. **What is derived state and why avoid storing it?** It's computable from other state; storing it creates two sources of truth that can disagree.
2. **Server-side vs client-side filtering — when do you use each?** Client-side for small, fully-loaded sets (instant, no requests). Server-side for large catalogs (less data, scales), at the cost of a request per change.
3. **How does changing a component's `key` reset its state?** React treats a different key as a different component instance: it unmounts the old one and mounts a new one with fresh state.
4. **Why is `array.sort()` dangerous with React state?** It mutates in place, so the old and new references are the same array and React may skip re-rendering.

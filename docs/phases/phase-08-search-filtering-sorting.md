# Phase 8 — Search, filtering, and sorting

**Goal:** polished product discovery: live suggestions, debounced search, shareable filters, and a mobile filter panel.

## What was built

| Feature | Where |
| --- | --- |
| Search by product name (server) | `searchProducts` → `/products/search?q=` |
| Search suggestions (combobox) | `components/common/SearchBar.jsx` → `getSearchSuggestions` (6 results, 5 fields) |
| Debounced search | `hooks/useDebouncedValue.js` (300 ms) |
| Category, price, brand, rating, availability filters | `CatalogFilters` (Phase 4), now URL-backed |
| Multiple active filters + chips to clear each one | `components/product/ActiveFilters.jsx` |
| Clear all | chips' "Clear all" and the filter panel's "Clear all (n)" |
| Sorting, result count, pagination | Phase 4, now URL-backed |
| URL-based filters | `utils/catalogParams.js` (`readCatalogParams`, `withFilters`, `withParam`) |
| Responsive mobile filter panel | `Modal variant="drawer"` with a live "Show N products" button |

### URL format
```
/categories/smartphones?brand=Apple&brand=Samsung&minPrice=100&maxPrice=900
                       &rating=4&available=1&sort=price-asc&view=list&page=2
/products?q=phone&brand=Apple
```

## Debouncing

**Concept.** Wait until the user *stops* typing for a moment before reacting.
**Why it matters.** Without it, typing "laptop" sends 6 requests (l, la, lap…). With 300 ms debouncing it sends one. That's kinder to the API's rate limit (~100 requests per window) and avoids flickering results.

```js
// hooks/useDebouncedValue.js
useEffect(() => {
  const timerId = setTimeout(() => setDebouncedValue(value), delayMs)
  return () => clearTimeout(timerId) // a new keystroke cancels the pending update
}, [value, delayMs])
```

The browser test types "lapto" with 40 ms between keys and confirms exactly **one** suggestion request was sent. `useFetch` also aborts a request if a newer query replaces it.

**Debounce vs throttle:** debounce = run once after the activity stops (search boxes); throttle = run at most every N ms during the activity (scroll or resize handlers).

## Client-side vs server-side searching

| | Server-side (BuyNest) | Client-side |
| --- | --- | --- |
| How | `GET /products/search?q=phone` | Download all products, `filter()` by title |
| Pros | Scales to millions of products; server can rank results, handle typos and synonyms | Instant, no requests |
| Cons | Network delay per query | Only works for small catalogs; no relevance ranking |

BuyNest searches on the server and filters the *results* on the client (price, brand…), because DummyJSON can't filter by those.

## Synchronizing filters with the URL

**Before (Phase 4):** filters lived in `useState`. Opening a product and pressing Back lost them, and a filtered page couldn't be shared.
**Now:** the URL is the single source of truth.

```
user clicks "Samsung"
  → handleFiltersChange(nextFilters)
  → setSearchParams(withFilters(searchParams, nextFilters), { replace: true })
  → URL changes → component re-renders
  → readCatalogParams(searchParams) → filters → checkbox checked, results filtered
```

Decisions:
- **`replace: true` for filters and sort.** Typing "250" in a price box shouldn't create three Back-button entries. **Page changes push** a new entry, so Back walks through pages.
- **Validate everything read from the URL.** `?rating=9&page=-3&minPrice=abc` falls back to defaults; an unknown brand appears as a removable chip instead of silently returning nothing.
- **Filters reset the page** to 1 (`withFilters` deletes `page`).

### A real bug we hit: transitions vs controlled inputs
React Router renders URL changes as a **transition** by default (low priority, interruptible). A checkbox whose `checked` comes from the URL therefore snapped back to unchecked for ~100–200 ms after a click, then checked itself. The browser test caught it. Fix in `main.jsx`:
```jsx
<BrowserRouter useTransitions={false}>
```
Trade-off: with transitions off, lazy routes (Phase 11) show their Suspense fallback during navigation instead of keeping the old page visible. For a store with URL-driven forms, instant inputs matter more.

## useMemo

**Concept.** `useMemo(fn, deps)` caches a calculated value and recalculates only when a dependency changes.
**BuyNest.**
```js
const { filters, page, layout } = useMemo(() => readCatalogParams(searchParams), [searchParams])
const visibleProducts = useMemo(
  () => sortProducts(filterProducts(products ?? [], filters), sortOption.value),
  [products, filters, sortOption.value],
)
```
The first `useMemo` matters for correctness of the second: without it, `filters` would be a **new object every render**, so the second memo would never hit its cache.

**When not to use it.** Cheap calculations (formatting a price, building six chips) don't need it; the memo's bookkeeping costs more than it saves. Measure with the React Profiler (Phase 11) before optimizing. `useMemo` is a performance hint, never a correctness guarantee.

## Performance notes
- Suggestions request only 6 items and 5 fields (`select=`), about 1 KB.
- Debounce + abort means at most one request in flight per search box.
- Filtering 194 products is ~0.1 ms; the memo mainly avoids repeating it when the cart drawer or quick view re-renders the page.

## Accessible search suggestions (combobox pattern)
- The input has `role="combobox"`, `aria-expanded`, `aria-controls` (the listbox), `aria-autocomplete="list"`, and `aria-activedescendant` (the highlighted option). Focus stays in the input while ↓/↑ move the highlight.
- Options have `role="option"` and `aria-selected`.
- A visually hidden `role="status"` announces "6 suggestions available".
- Options use `onMouseDown` + `preventDefault()` so the click lands before the input's `blur` closes the list.
- The highlight is **derived** (stored together with the query it belongs to), so typing a new letter resets it without an effect.

## Verify it
1. Type "lapto" in the header search → suggestions with **lapto** highlighted; DevTools → Network shows one `search?q=lapto&limit=6` request.
2. ↓ then Enter → opens the product. Escape closes the list. "See all N results" → `/products?q=…`.
3. `/categories/smartphones`: check Samsung + Vivo and "4 & up" → the URL shows `brand=Samsung&brand=Vivo&rating=4`. Open a product, press Back → everything is restored.
4. Remove the "Vivo" chip; remove the "Category" chip (→ `/products`, Samsung kept).
5. Go to page 3, open a product, Back → page 3. Change sort → back to page 1.
6. Phone width: "Filters" opens a drawer; checking Apple updates "Show 4 products".

## Common errors
- **Results don't update after changing a filter:** you mutated `searchParams` instead of creating `new URLSearchParams(searchParams)`.
- **Two filter panels interfere:** radio buttons with the same `name` form one group across the whole page; we give each instance a `useId()` name.
- **Suggestions close before a click registers:** use `onMouseDown` with `preventDefault()`, or delay the blur.
- **Every keystroke makes a Back entry:** pass `{ replace: true }`.

## Practice
Remember the last 5 searches in `localStorage` and show them as suggestions when the search box is focused and empty. Should the recent-search list be state, derived, or both?

## Interview questions
1. **Debounce vs throttle?** Debounce fires once after activity stops; throttle fires at a fixed maximum rate during activity.
2. **Why put filters in the URL instead of state?** Back/forward, refresh, bookmarking, and sharing all work, and there's one source of truth.
3. **When is `useMemo` worth it?** For expensive calculations, or to keep an object/array identity stable for other memos, effects, or memoized children. Not for cheap values.
4. **How do you make an autocomplete accessible?** The ARIA combobox pattern: `role="combobox"` + `listbox`/`option`, `aria-expanded`, `aria-activedescendant`, keyboard support, and a live region for result counts.

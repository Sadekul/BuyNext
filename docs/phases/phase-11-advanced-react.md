# Phase 11 — Advanced React

**Goal:** revisit every important hook and pattern using real BuyNest code, add the performance tools that matter, and move server data to TanStack Query.

## Where each hook lives in BuyNest

| Hook | Real example | What it does there |
| --- | --- | --- |
| `useState` | `Header` (`isMenuOpen`), `Catalog` (`quickViewProduct`) | Local UI state |
| `useEffect` | `usePersistentReducer` (save to localStorage), `Toast` (timer + cleanup), `useProductRefresh` (sync server data into the cart) | Synchronize with something outside React |
| `useRef` | `Modal` (`dialogRef.current.showModal()`), `Catalog` (`toolbarRef.scrollIntoView()`), `Modal` (`pressStartedOnBackdropRef`) | DOM access and values that must not trigger renders |
| `useContext` | `useCart`, `useWishlist`, `useAuth`, `useOrders` | Read shared state without prop drilling |
| `useReducer` | `cartReducer`, `wishlistReducer`, `ordersReducer` (via `usePersistentReducer`) | Many related updates with rules |
| `useMemo` | `Catalog` (`readCatalogParams`, filter + sort), `CartProvider` (context value) | Cache expensive or identity-sensitive values |
| `useCallback` | `CartProvider` actions, `HomePage`/`Catalog` `handleAddToCart` | Stable functions for memoized children and effect dependencies |
| `useId` | `FormField`, `SearchBar`, `CatalogFilters` (radio group name) | Unique, SSR-safe ids for labels and ARIA |
| `useEffectEvent` | `AuthProvider` (`checkStoredSession`) | Read the latest values in an effect without re-running it |
| `useSyncExternalStore` | `useOnlineStatus` | Subscribe to an outside source (`navigator.onLine`) |
| Custom hooks | `useDebouncedValue`, `usePersistentReducer`, `useProductRefresh`, `useOnlineStatus` | Reuse stateful logic |

## Class components and lifecycle methods
`learning/OnlineStatusClass.jsx` vs `hooks/useOnlineStatus.js` (side by side on `/learn`):

| Class | Hook equivalent |
| --- | --- |
| `componentDidMount()` | `useEffect(() => { … }, [])` |
| `componentDidUpdate(prevProps, prevState)` | `useEffect(() => { … }, [deps])` |
| `componentWillUnmount()` | the function returned from `useEffect` |
| `this.state` / `this.setState` | `useState` |

New code uses hooks: logic for one concern stays together, instead of being split across three lifecycle methods.

## Error boundaries
`components/common/ErrorBoundary.jsx` is a **class** (no hook can catch render errors):
- `static getDerivedStateFromError(error)` → switch to the fallback on the next render.
- `componentDidCatch(error, info)` → report it (e.g. Sentry).
- `MainLayout` wraps each page: `<ErrorBoundary key={pathname}>`. A crash in one page shows "Something went wrong on this page" while the header, cart, and navigation keep working; navigating elsewhere resets it.
- If a lazy page's JavaScript fails to download (common right after a deploy), it offers "Reload page".
- **Not caught:** errors in event handlers, promises, or timers. Handle those with `try/catch` and error state (as the forms do).

Try it: `/learn` → click "BuggyCounter" three times.

## Controlled vs uncontrolled components
| Controlled | Uncontrolled |
| --- | --- |
| Value lives in React state: `value={x} onChange={…}` | Value lives in the DOM; read it when needed (`ref`, `FormData`) |
| `SearchBar`, filters, login/register | Checkout (React Hook Form `register`) |
| Instant validation and formatting; re-renders on every keystroke | Fewer re-renders; great for large forms |

## Refs and DOM access
Use refs for things React doesn't model: opening a `<dialog>`, scrolling, focusing, measuring. Never use them to change what React renders (no `ref.current.innerHTML = …`).

## Performance

### React.memo
`ProductCard` is wrapped in `memo`: if its props are the same as last time, React skips it. It works only because its props are **stable**: product objects come from the query cache, and `onAddToCart` is wrapped in `useCallback`. Opening the cart drawer or Quick view re-renders the catalog page, but its 12 cards are skipped.
- **When it helps:** a component that renders often with the same props and isn't trivial (list items, charts).
- **When it doesn't:** props change every time anyway (new objects or inline functions), or the component is tiny. The comparison then costs more than it saves.

### useMemo vs useCallback
| | Caches | Example |
| --- | --- | --- |
| `useMemo(() => compute(), deps)` | a **value** | `visibleProducts` in the catalog |
| `useCallback(fn, deps)` | a **function** (= `useMemo(() => fn, deps)`) | `handleAddToCart` |
Both are optimizations, not guarantees. Add them when profiling shows a problem or when stable identity matters (memoized children, effect dependencies, context values).

### React.lazy, Suspense, and code splitting
`routes/AppRoutes.jsx` keeps home/catalog/product in the main bundle and lazy-loads the rest:
```js
const CheckoutPage = lazy(() => import('../pages/CheckoutPage'))
```
`MainLayout` wraps the `<Outlet />` in `<Suspense fallback={<PageLoader />}>`. Production build result: the checkout's form libraries (~128 KB, ~39 KB gzipped) and the learning lab with Axios (~68 KB) only download when visited. The browser test checks that the homepage never requests them.

### Lazy loading images
Every product, category, and gallery thumbnail uses `loading="lazy"` with `width`/`height` (no layout shift). The hero image and the main gallery image use `fetchPriority="high"` instead, because they're the most important images above the fold.

### Reducing unnecessary re-renders (checklist)
1. Keep state as low as possible (the mobile filter drawer's state lives in `Catalog`, not the page).
2. Derive values instead of syncing state with effects.
3. Stable context values (`useMemo`) and functions (`useCallback`) in providers.
4. Split contexts by how often they change (cart vs wishlist vs auth are separate).
5. Memoize expensive list items (`ProductCard`).

### List virtualization (when needed)
Virtualization (e.g. `@tanstack/react-virtual`) renders only the rows on screen. BuyNest **doesn't need it**: the catalog shows 12 products per page. Consider it for 500+ visible rows (an admin orders table, an infinite feed). Adding it earlier would add complexity for no measurable gain.

### React Developer Tools and the Profiler
1. Install React Developer Tools (Chrome/Firefox).
2. **Components** tab: inspect props, state, hooks, and context of any component; edit state live.
3. **Profiler** tab → ⚙ → enable "Highlight updates when components render" and "Record why each component rendered".
4. Record while opening the cart drawer on `/products`: the `ProductCard`s should show as *did not render* (memo working). Remove `memo` and record again to compare.

## TanStack Query (server state)

**Server state vs client state**
| Server state | Client state |
| --- | --- |
| Owned by the server; can change without you knowing; needs fetching, caching, refreshing | Owned by the browser; changes only through your code |
| Products, categories, profile | Cart, wishlist, menu open, filters in the URL |
| TanStack Query | `useState`, `useReducer`, Context, URL |

**What replaced `useFetch`**
```js
// queries/productQueries.js
export const productQuery = (id) => queryOptions({
  queryKey: productKeys.detail(id),             // ['products', 'detail', '78']
  queryFn: ({ signal }) => getProductById(id, { signal }),
})
// any component
const { data, isPending, error, refetch } = useQuery(productQuery(id))
```

| Feature | Where in BuyNest |
| --- | --- |
| **Query caching** | Quick view and details share `['products','detail',id]`: opening details after Quick view sends **no** request (tested). The homepage, cart, and wishlist share `['products','list','all']`. |
| **Request states** | `isPending` (no data yet), `isFetching` (any request in flight, e.g. the cart's "Checking the latest prices…"), `isError`/`error`, `isSuccess` |
| **Query invalidation** | After an order, `invalidateQueries({ queryKey: productKeys.all })` marks every product query stale (stock changed) |
| **Background refetching** | `staleTime: 60s` app-wide; categories 1 h. `refetchOnWindowFocus`: returning to the tab refreshes stale data. The cart/wishlist price check uses `refetchOnMount: 'always'`. |
| **Pagination** | The catalog paginates client-side (the full scope is cached). With a real paginated API you'd use `queryKey: ['products', { page }]` plus `placeholderData: keepPreviousData`, so the old page stays visible while the next one loads. |
| **Mutations** | Registration (`useMutation(registerCustomer)`), checkout price check (`mutateAsync`), profile name edit |
| **Optimistic updates** | Profile name: `onMutate` updates the cache immediately, `onError` restores the snapshot (tested with a slow and a failing request) |
| **Error and retry strategy** | `lib/queryClient.js`: retry network/5xx/408/429 twice with backoff; never retry other 4xx; never retry mutations (no double orders) |
| **Cancellation** | `queryFn` receives `signal`; unused queries are cancelled automatically |
| **Privacy** | Cached profiles are removed on sign-out |

Note on DummyJSON: the profile edit isn't saved by the server, so BuyNest doesn't refetch after it (a refetch would bring the old name back). With a real API you'd add `onSettled: () => invalidateQueries(...)` to sync with the server's truth.

## Offline awareness
`OfflineBanner` (in `MainLayout`) uses `useOnlineStatus`: "You're offline…" appears when the connection drops. TanStack Query also pauses requests while offline and resumes them on reconnect.

## Verify it
1. DevTools → Network: open home → Shop all → Home. The second home visit makes no `products?limit=0` request.
2. Quick view a laptop → "View full details": no second `/products/78` request.
3. `/products/99999`: one request (404s aren't retried).
4. Network → Offline → the banner appears; back online → it disappears.
5. `/learn` → BuggyCounter crashes at 3 inside its boundary; "Reset" recovers.
6. `/account` → Edit name → the name changes instantly; the header updates when the server answers.
7. `npm run build`: separate chunks for CheckoutPage, ComponentLabPage, account pages, and so on.

> In development you'll see some requests twice, the first cancelled: React StrictMode mounts components twice to surface missing cleanups. Production doesn't do this.

## Practice
1. Prefetch a product on hover: `queryClient.prefetchQuery(productQuery(id))` in `ProductCard`'s `onMouseEnter`, so the details page opens instantly.
2. Record a Profiler session with and without `memo(ProductCard)` and compare the render counts.

## Interview questions
1. **Server state vs client state — why use different tools?** Server state is a cache of someone else's data (it needs fetching, deduping, refreshing, invalidating); client state is owned by the UI.
2. **When does `React.memo` not help?** When props change every render (new objects or functions), or the component is cheap.
3. **What do error boundaries catch and not catch?** They catch errors during rendering, lifecycle methods, and constructors below them; not event handlers, async code, or SSR.
4. **What is an optimistic update and its risk?** Showing the expected result before the server confirms; you must roll back on failure and resync afterwards.
5. **How does code splitting improve performance?** Less JavaScript to download and parse for the first page; other routes load on demand.
6. **`isPending` vs `isFetching` in TanStack Query?** `isPending`: no data yet. `isFetching`: a request is in flight, including background refetches while old data is shown.

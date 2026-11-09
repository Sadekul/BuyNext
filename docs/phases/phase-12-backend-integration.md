# Phase 12 — Integration with an admin backend (frontend side)

**Goal:** make switching from DummyJSON to a real Laravel backend (and later Shopify or Magento) a configuration change, not a rewrite, and document how the admin dashboard, API, database, and storefront fit together. As the project plan says, the backend itself is **not** built yet.

## What was built
| Piece | Where |
| --- | --- |
| Provider layer (endpoints + adapter per backend) | `services/providers/{index,dummyJsonProvider,laravelProvider}.js` |
| Laravel adapter (snake_case, `data`/`meta`, decimal strings → BuyNest shapes) | `services/adapters/laravelAdapter.js` |
| Backend switch | `VITE_API_PROVIDER=dummyjson | laravel` (`.env.example`) |
| Backend-agnostic services | `services/productService.js`, `categoryService.js` |
| "All pages" fetching for paginated APIs (parallel `Promise.all`) | `getProductList` in `productService.js` |
| Sanctum-ready client: `credentials: 'include'`, `X-XSRF-TOKEN` on writes, 419/422 messages | `services/apiClient.js` |
| Server validation errors → form fields | `ApiError.fieldErrors`, `utils/serverErrors.js` (used by checkout) |
| API contract | `docs/backend/API_CONTRACT.md` |
| Admin flow, admin-managed data, permissions, Shopify/Magento | `docs/backend/ADMIN_INTEGRATION.md` |

## Concept: the adapter (anti-corruption) layer
**Problem.** Every backend names things differently: DummyJSON says `title`, `discountPercentage`, and plain numbers; Laravel says `name`, `discount_percent`, and `"1099.99"` strings; Shopify says `node.title` and `priceRange.minVariantPrice.amount`. If components read raw responses, switching backends means editing dozens of components.

**Solution.** Components only see **BuyNest shapes** (`{ id, title, price, discountPercentage, … }`). Each backend gets:
1. a **provider**: which URL and parameters to use for each operation;
2. an **adapter**: how to turn its responses into BuyNest shapes.

```js
// services/productService.js (backend-agnostic)
const { catalog, adapter } = apiProvider
const { path, params } = catalog.productDetail(id)          // where?
return adapter.product(await apiClient.get(path, { params })) // what does it mean?
```

## How it was verified
1. All browser suites still pass on DummyJSON.
2. A throwaway mock Laravel server (outside the project) served real product data in the contract's shape. The storefront ran on port 5174 with `VITE_API_PROVIDER=laravel`. 16 checks passed: home, catalog (194 products from two parallel pages), search via `?search=`, suggestions, category + brand filter, price sorting, product details (string prices converted, nested brand/category, reviews), 404, add to cart. **No component was changed, and no API call went to DummyJSON.**

## Promise.all for parallel requests
The contract caps `per_page` at 100, but the current catalog needs the whole scope. `getProductList` fetches page 1, reads `total`, then requests the remaining pages **at the same time**:
```js
const rest = await Promise.all(pages.map((page) => getProductPage(endpointFor(page), signal)))
```
Sequential requests would take `n × latency`; parallel ones take about one latency. If any page fails, `Promise.all` rejects and TanStack Query's retry policy applies to the whole scope.

## CSRF with cookie sessions
With Sanctum, the browser sends the session cookie automatically, so a malicious site could trigger requests (CSRF). Laravel defends with the `XSRF-TOKEN` cookie: our `apiClient` copies it into the `X-XSRF-TOKEN` header for non-GET requests, and an attacker's site can't read your cookies to do the same. A missing or expired token returns **419**.

## Mapping server validation errors (422)
```js
// CheckoutPage onSubmit catch
if (applyServerFieldErrors(error, setError, SERVER_FIELD_MAP)) return
// { errors: { "shipping_address.postal_code": ["The postal code is invalid."] } }
//   → setError('shipping.postalCode', { message: 'The postal code is invalid.' })
```
Client-side Zod catches typos instantly; the server has the final word (e.g. "We don't ship to this postal code").

## Read next
- `docs/backend/API_CONTRACT.md`: endpoints, resources, errors, auth, orders, payments, migration steps.
- `docs/backend/ADMIN_INTEGRATION.md`: admin → API → MySQL → storefront, admin-managed data, backend-enforced permissions, Shopify vs Magento public/private APIs.

## Practice
Write a `shopifyProvider` sketch: `catalog.productDetail(handle)` returns a GraphQL `POST` body, and `adapter.product` maps `node.title`, `node.priceRange.minVariantPrice.amount`, and `node.images.edges[].node.url`. Which BuyNest fields have no Shopify equivalent?

## Interview questions
1. **Why put an adapter between the API and components?** It isolates components from backend formats; switching or versioning the API changes one module.
2. **Why are money values strings in the API?** Decimal precision; floats can't represent most cents exactly.
3. **How does CSRF protection work with cookie-based SPA auth?** The server sets a readable `XSRF-TOKEN` cookie; the SPA echoes it in a header; other origins can't read it, so they can't forge the header.
4. **Shopify Storefront API vs Admin API?** Storefront: public token, safe in the browser, limited to shopping. Admin: private token, full store control, server-only.
5. **Who enforces admin permissions?** The backend (auth middleware, roles, policies), on every request. UI hiding is only convenience.

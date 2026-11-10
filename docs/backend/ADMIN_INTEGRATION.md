# Admin backend integration

How the React admin dashboard, the Laravel API, and the storefront fit together.

> **Update (2026-11-10, backend phase 1):** admins are now real accounts in Laravel's `admins` table, separate from customers, with their own sign-in (`/api/admin/v1/auth/*`) and their own cookies. The customers page lists the real sign-ups and can block/unblock them (`/api/admin/v1/customers`). Products, orders, and the overview still use the demo data below until phase 2. See [ACCOUNTS.md](ACCOUNTS.md).
>
> **Earlier status:** the admin dashboard exists ([admin/](../../admin/README.md), served at `/admin/`) and runs on demo data through BuyNest's own admin API, `frontend/server/adminApi.js` (`/api/admin/*`). That API already does what the Laravel version must do: it checks the signed-in account's role on every request (403 for customers), validates product writes with Laravel-style 422 errors, and allow-lists every field sent to the browser. DummyJSON doesn't store changes, so edits are simulated. When Laravel exists, its endpoints replace that file (same shapes, real saves, a Policy instead of the role check), and the dashboard keeps working without changes.

## The flow
```
Admin Dashboard (React, admin/)
      │  PUT /api/admin/v1/products/123   (admin session + role check)
      ▼
Backend REST API (Laravel)
      │  validate → authorize (Policy) → Eloquent update → clear caches
      ▼
MySQL Database
      │
      │  GET /api/v1/products/123   (public, cached)
      ▼
React BuyNest Frontend (frontend/)
      │  TanStack Query cache (staleTime 60 s, refetch on focus)
      ▼
Customer sees the updated product
```
How fast the customer sees a change depends on caching: the API (HTTP cache headers or Redis), any CDN, and the storefront's `staleTime`. For price changes the checkout is always correct anyway, because `POST /api/v1/orders` re-reads prices from the database.

## Admin-managed data
| Data | Admin API (examples) | Storefront reads it via |
| --- | --- | --- |
| Products: create, update, delete, status (draft/active/archived) | `POST/PUT/DELETE /api/admin/v1/products` | `/api/v1/products` (active only) |
| Product images | `POST /api/admin/v1/products/{id}/images` (multipart upload → S3) | `images[].url` |
| Categories, brands | `/api/admin/v1/categories`, `/brands` | `/api/v1/categories`, `brand` |
| Prices, discounts | `PUT …/products/{id}` (`price`, `discount_percent`), `/api/admin/v1/coupons` | ProductResource; coupons only server-side |
| Inventory | `PATCH …/products/{id}/stock` (audit log) | `stock_quantity`, `availability` |
| Customers | `/api/admin/v1/customers` (read, disable) | — |
| Orders | `/api/admin/v1/orders` (status changes: processing → shipped → delivered) | `/api/v1/orders` (customer's own) |
| Homepage banners, featured products, content sections | `/api/admin/v1/content/home` | `/api/v1/home` (replaces `data/homeContent.js`) |

## Permissions are enforced by the backend
Hiding a button in the admin UI is **not** security; anyone can call the API directly.
- Every admin route: `auth:sanctum` + a role/permission check (e.g. `spatie/laravel-permission`: `admin`, `catalog-manager`, `support`).
- Every action: a Laravel **Policy** (`ProductPolicy::update`).
- Separate route groups and rate limits for `/api/admin/*`; audit log for price, stock, and order status changes.
- The storefront never calls admin endpoints, and admin credentials never exist in storefront code.

## The adapter layer (why components won't change)
```
Component ─▶ queries/ ─▶ productService ─▶ apiProvider.catalog.* (endpoints)
                                   └──────▶ apiProvider.adapter.*  (response → BuyNest shape)
```
- `services/providers/dummyJsonProvider.js`: today's learning API.
- `services/providers/laravelProvider.js` + `adapters/laravelAdapter.js`: the contract in `API_CONTRACT.md`.
- Switch with `VITE_API_PROVIDER=laravel`.

**Verified:** the storefront was run with `VITE_API_PROVIDER=laravel` against a local mock that serves real product data in the contract's shape (snake_case, `data`/`meta`, decimal strings, nested brand/category, 100-per-page limit). The homepage, catalog (both pages merged), search, suggestions, category filters, sorting, product details, reviews, 404 handling, and the cart all worked with **no component changes**, and no API request went to DummyJSON.

## Shopify and Magento (Adobe Commerce)
Both would be one more provider plus adapter. Know which API is which:

| | Public, storefront-safe | Private, server-only |
| --- | --- | --- |
| **Shopify** | **Storefront API** (GraphQL) with a *public* Storefront access token; read products/collections, create carts, hand off to Shopify Checkout | **Admin API** (REST/GraphQL) with an Admin token: products, orders, inventory. **Never in the browser.** |
| **Magento / Adobe Commerce** | Guest REST/GraphQL endpoints (catalog, guest carts) and customer tokens for the signed-in customer's own data | **Integration / admin tokens** (OAuth) for catalog and order management. **Server-only.** |

Rules:
- Anything shipped to the browser is public. `VITE_*` variables end up in the JavaScript bundle; put only public, scope-limited tokens there.
- Admin operations go through **your** backend (Laravel), which holds the private credentials and checks permissions.
- Shopify Storefront is GraphQL: the provider would `POST /api/2025-xx/graphql.json` with a query, and its adapter would read `data.products.edges[].node`.
- Rate limits differ (Shopify uses query cost); cache aggressively with TanStack Query.

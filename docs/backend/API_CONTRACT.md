# BuyNest REST API contract (proposed, v1)

The API the Laravel backend ([backend/](../../backend/README.md)) provides for the storefront. The frontend's Laravel provider (`frontend/src/services/providers/laravelProvider.js`) and adapter (`frontend/src/services/adapters/laravelAdapter.js`) are written against this document. **Status (2026-11-10):** the authentication and customer-profile endpoints exist (backend phase 1, see [ACCOUNTS.md](ACCOUNTS.md)); the catalog, cart, and order endpoints below are still the agreement for phase 2.

## Conventions
- Base path: `/api/v1`. JSON only (`Accept: application/json`).
- Field names: `snake_case`. Money: decimal **strings** with 2 places (`"1099.99"`), never floats. The frontend converts with `Number()` for display only.
- Single resources are wrapped: `{ "data": { … } }`. Collections are paginated:
```json
{
  "data": [ { … } ],
  "meta": { "current_page": 1, "per_page": 12, "total": 194, "last_page": 17 },
  "links": { "first": "…", "last": "…", "prev": null, "next": "…" }
}
```
- Timestamps: ISO 8601 UTC (`"2026-11-09T09:41:02Z"`).

## Errors
| Status | When | Body |
| --- | --- | --- |
| 401 | Not signed in / session expired | `{ "message": "Unauthenticated." }` |
| 403 | Signed in but not allowed (policy) | `{ "message": "This action is unauthorized." }` |
| 404 | Resource doesn't exist (or isn't yours) | `{ "message": "Product not found." }` |
| 419 | CSRF token missing or expired (Sanctum) | `{ "message": "CSRF token mismatch." }` |
| 422 | Validation failed | `{ "message": "…", "errors": { "shipping_address.postal_code": ["The postal code is invalid."] } }` |
| 429 | Rate limited | `{ "message": "Too Many Attempts." }` + `Retry-After` header |
| 5xx | Server error | `{ "message": "Server Error" }` (no stack traces in production) |

The frontend maps 422 `errors` onto form fields (`utils/serverErrors.js`, used by checkout).

## Authentication (built: Sanctum tokens behind the sign-in service)
The browser never calls these endpoints or holds a token. The storefront's sign-in service (`frontend/server/`) calls them server to server and keeps the tokens in HttpOnly, Secure, SameSite=Strict cookies. (This replaced the earlier plan of Sanctum's cookie "SPA mode": the sign-in service already gave the browser the same protection, and tokens keep the API stateless.) Full design: [ACCOUNTS.md](ACCOUNTS.md).

| Method | Path | Body → answer |
| --- | --- | --- |
| POST | `/api/v1/auth/register` | `first_name, last_name, email, phone, password, password_confirmation, accept_terms` → `201 { data: { email, expires_in, resend_in } }`; a 6-digit code is emailed |
| POST | `/api/v1/auth/verify-email` | `email, code, remember` → `{ data: { customer, tokens } }` |
| POST | `/api/v1/auth/resend-code` | `email, purpose` → `{ data: { email, expires_in, resend_in } }` (same for every email) |
| POST | `/api/v1/auth/login` | `email, password, remember` → `{ data: { customer, tokens } }`; unconfirmed email → `403 { code: "email_unverified", data }`; blocked → `403 { code: "account_disabled" }` |
| POST | `/api/v1/auth/refresh` | `refresh_token` → `{ data: { tokens } }` (rotation: the old pair stops working) |
| POST | `/api/v1/auth/forgot-password` | `email` → same answer for every email |
| POST | `/api/v1/auth/reset-password` | `email, code, password, password_confirmation` → every device signed out |
| POST | `/api/v1/auth/logout` | Bearer access token → this device signed out |

`tokens`: `{ access_token, access_expires_in, refresh_token, refresh_expires_in, remember }`. Admins use the same shapes under `/api/admin/v1/auth/*` with their own table and tokens.

**CustomerResource**: `{ id, first_name, last_name, email, phone, email_verified, created_at }`. Phone numbers are stored in international form (`+8801712345678`).

## Catalog (public)
### `GET /api/v1/products`
| Query | Example | Notes |
| --- | --- | --- |
| `search` | `phone` | name + description |
| `category` | `smartphones` | category slug |
| `brand[]` | `Apple` | repeatable |
| `min_price`, `max_price` | `100`, `900` | on the price the customer pays |
| `min_rating` | `4` | |
| `available` | `1` | in stock and stock ≥ minimum order |
| `sort` / `direction` | `price` / `asc` | `price`, `rating`, `discount`, `name`, `newest` |
| `page`, `per_page` | `2`, `12` | `per_page` max 100 |

**ProductResource**
```json
{
  "id": 123,
  "name": "iPhone 13 Pro",
  "slug": "iphone-13-pro",
  "description": "…",
  "brand": { "name": "Apple" },
  "category": { "slug": "smartphones", "name": "Smartphones" },
  "price": "1099.99",
  "discount_percent": 9.37,
  "rating_average": "4.12",
  "stock_quantity": 56,
  "availability": "in_stock",
  "min_order_quantity": 1,
  "thumbnail_url": "https://…/thumbnail.webp",
  "images": [{ "url": "https://…/1.webp", "alt": "iPhone 13 Pro, back" }],
  "sku": "SMA-APP-IPH-123",
  "tags": ["smartphones", "apple"],
  "warranty": "3 year warranty",
  "shipping_info": "Ships in 2 weeks",
  "return_policy": "7 days return policy",
  "reviews": [{ "rating": 5, "comment": "…", "created_at": "…", "author_name": "…" }]
}
```
`availability`: `in_stock` | `low_stock` | `out_of_stock`. `brand` may be `null`. Lists may omit `description`, `images`, and `reviews`.

### Others
- `GET /api/v1/products/{id}` → `{ data: ProductResource }` (only `active` products; drafts → 404).
- `GET /api/v1/categories` → `{ data: [{ slug, name, image_url }] }`
- `GET /api/v1/home` → admin-managed content: `{ data: { hero, banners[], collections: { featured[], new_arrivals[], best_sellers[] } } }`

## Customer (requires sign-in)
| Method | Path | Notes |
| --- | --- | --- |
| GET/PATCH | `/api/v1/me` | profile (allow-listed fields only, never password hashes). **Built.** PATCH: `first_name, last_name, phone` (a new email must be verified first) |
| GET/PUT | `/api/v1/me/addresses` | saved addresses |
| GET | `/api/v1/wishlist` | product IDs + summaries |
| POST/DELETE | `/api/v1/wishlist/{productId}` | idempotent |
| POST | `/api/v1/cart/validate` | `{ items: [{ product_id, quantity }], coupon_code }` → server prices, stock, discount, shipping options, `problems[]` |
| POST | `/api/v1/orders` | `{ items, shipping_address, billing_address, shipping_method, coupon_code, payment_method }` → `201 { data: Order }` with server-calculated totals and `status: "pending_payment"` |
| GET | `/api/v1/orders` | the customer's orders only (paginated) |
| GET | `/api/v1/orders/{id}` | 404 if it belongs to someone else (prevents IDOR) |

**Order totals are always calculated by the server** from database prices, stock (reserved in a transaction), coupon rules, shipping rates, and taxes. Request bodies never contain prices.

## Payments
`POST /api/v1/orders/{id}/payment-intent` → client secret / hosted checkout URL from the payment provider. The order becomes `paid` only via the provider's **webhook** (`POST /api/webhooks/stripe`, signature verified). The storefront never sends card data to this API.

## Migration notes (frontend)
1. Set `VITE_API_PROVIDER=laravel` and `VITE_API_BASE_URL`.
2. Catalog: today the storefront downloads the whole scope and filters in the browser (DummyJSON can't filter). With this API, move price/brand/rating/availability/sort/page into the query key and request parameters (`catalogQuery` → server-side), and drop the "fetch every page" path.
3. Auth: replace `authService` token calls with the Sanctum flow above; `AuthProvider` keeps the same public API (`login`, `logout`, `user`, `status`).
4. Cart/checkout: replace `POST /carts/add` with `POST /api/v1/cart/validate` and `POST /api/v1/orders`; delete the demo `OrdersProvider` storage in favor of `GET /api/v1/orders`.

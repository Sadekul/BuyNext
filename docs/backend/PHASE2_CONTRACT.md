# Backend phase 2 contract: catalog, cart pricing, real orders

The agreement between the Laravel API (`backend/`) and the sign-in service plus the two React apps (`frontend/`, `admin/`) for phase 2. Conventions are those of [API_CONTRACT.md](API_CONTRACT.md): JSON, `snake_case`, money as **decimal strings with 2 places**, `{ data }` wrappers, paginated `{ data, meta: { current_page, per_page, total, last_page }, links }`, Laravel 422 errors, ISO 8601 UTC timestamps. Customer and admin tokens work as in [ACCOUNTS.md](ACCOUNTS.md).

## Goals

1. Products, categories, brands, images, and reviews live in MySQL. The current DummyJSON catalog (194 products) is imported once, so the store looks the same.
2. The **server prices everything**: carts and orders send product ids and quantities, never prices.
3. Orders are real: stored, stock is reserved, a confirmation email is sent, customers see their history, admins manage them.
4. **Guests can buy** (decision 2026-11-10). A guest gives an email; they can look up an order later with its number and that email.
5. Everything from phase 1 keeps working, and `VITE_ACCOUNTS_BACKEND=dummyjson` / `VITE_API_PROVIDER=dummyjson` still work as before (demo mode).

## Store rules (server config, `config/buynest.php`; moved into the admin in phase 3/4)

| Rule | Value |
| --- | --- |
| Currency | USD |
| Standard shipping | `4.99`, free when the merchandise total after the coupon is at least `50.00` |
| Express shipping | `12.99` (1–2 business days) |
| Next day shipping | `24.99` (next business day, order by 2 pm) |
| Shipping method ids | `standard`, `express`, `nextDay` |
| Coupons (phase 2: config; phase 3: database) | `NEST10`: 10% off the merchandise. `SAVE20`: `20.00` off when the merchandise is at least `150.00`. Codes are case-insensitive. |
| Tax | `0.00` (phase 4: tax rules) |
| Low stock threshold | 10 units |
| Payment method ids | `card`, `paypal`, `cod` |

Line math, in **integer cents**: `sale_price = round(price × (1 − discount_percent / 100), 2)`; `line_total = sale_price × quantity`; `subtotal = Σ line_total`; coupon discount from the subtotal (percent: rounded to the cent; fixed: capped at the subtotal); `total = subtotal − discount + shipping + tax`. These match `frontend/src/utils/cartTotals.js` and `pricing.js`, so the numbers a shopper sees never jump at checkout.

## Data model

- `categories`: `id, slug (unique), name, image_url null, position, timestamps`.
- `brands`: `id, name (unique), timestamps`.
- `products`: `id, sku (unique), name, slug (unique), description text, category_id, brand_id null, price decimal(10,2), discount_percent decimal(5,2) default 0, stock_quantity unsigned int, min_order_quantity unsigned int default 1, status enum(draft, active, archived) default active, rating_average decimal(3,2) default 0, thumbnail_url null, warranty null, shipping_info null, return_policy null, weight null, tags json null, timestamps, soft deletes`.
- `product_images`: `id, product_id, url, alt null, position`.
- `reviews`: `id, product_id, customer_id null, author_name, rating 1–5, comment, created_at`.
- `orders`: `id, number (unique, "BN-100001": 100000 + id), customer_id null, email, phone, status, payment_status, payment_method, shipping_method, shipping_label, shipping_eta, coupon_code null, subtotal, discount_total, shipping_total, tax_total, grand_total (decimal(10,2)), shipping_address json, billing_address json, placed_at, timestamps`.
- `order_items`: `id, order_id, product_id null (null if the product is deleted later), sku, name, thumbnail_url, unit_price, discount_percent, sale_price, quantity, line_total`. **Snapshots**: an order never changes when the product changes later.
- `order_status_history`: `id, order_id, status, payment_status null, note null, admin_id null, customer_notified bool, created_at`.

Order `status`: `pending_payment` → `processing` → `shipped` → `delivered`; `cancelled` from `pending_payment` or `processing` (puts the stock back). `payment_status`: `unpaid`, `paid`. Allowed admin transitions: `pending_payment→processing|cancelled`, `processing→shipped|cancelled`, `shipped→delivered`. Anything else → 422 on `status`.

Payment in phase 2 (no payment provider yet, recorded honestly):
- `cod` (cash on delivery): order starts `processing` / `unpaid`; becomes `paid` when an admin marks it paid (normally on delivery).
- `card`, `paypal`: order starts `pending_payment` / `unpaid`. The storefront says payment by card/PayPal will happen on the provider's page once one is connected; an admin can mark it paid, which moves it to `processing`. (A Stripe webhook replaces that later.)

## Importing the catalog

`php artisan buynest:import-catalog` downloads `https://dummyjson.com/products?limit=0` (and `/products/categories`) and upserts categories, brands, products (DummyJSON id → our id, same `sku`), images, and reviews. Safe to run again (upsert by `sku`; product ids are kept equal to DummyJSON's ids so existing carts, wishlists, and links keep working). `DatabaseSeeder` runs it in `local` when the products table is empty. Tests never touch the network: they use factories.

## Public catalog API (no sign-in)

### `GET /api/v1/products`
Query: `search` (name, description, brand, category name), `category` (slug), `brand[]` (names), `min_price`, `max_price` (on the sale price), `min_rating`, `available=1` (stock ≥ min order quantity), `sort` = `price|rating|discount|name|newest`, `direction` = `asc|desc`, `page`, `per_page` (default 12, max 100). Only `status=active` products. Answer: paginated **ProductResource** list (lists may omit `description`, `images`, `reviews`).

### `GET /api/v1/products/{id}` → `{ data: ProductResource }` with `images` and `reviews`; drafts, archived, and deleted → 404 `{ "message": "Product not found." }`.

### `GET /api/v1/categories` → `{ data: [{ slug, name, image_url }] }` (only categories with active products, ordered by `position`, then name).

**ProductResource** (as in API_CONTRACT.md):
```json
{
  "id": 1, "name": "Essence Mascara Lash Princess", "slug": "essence-mascara-lash-princess", "sku": "BEA-ESS-ESS-001",
  "description": "…", "brand": { "name": "Essence" }, "category": { "slug": "beauty", "name": "Beauty" },
  "price": "9.99", "discount_percent": 10.48, "sale_price": "8.94", "rating_average": "2.56",
  "stock_quantity": 99, "availability": "in_stock", "min_order_quantity": 48,
  "thumbnail_url": "https://cdn.dummyjson.com/…/thumbnail.webp",
  "images": [{ "url": "https://…/1.webp", "alt": "Essence Mascara Lash Princess" }],
  "tags": ["beauty", "mascara"], "warranty": "1 week warranty", "shipping_info": "Ships in 3-5 business days",
  "return_policy": "No return policy", "weight": 4,
  "reviews": [{ "rating": 3, "comment": "Would not recommend!", "created_at": "…", "author_name": "Eleanor Collins" }]
}
```
`availability`: `out_of_stock` when stock is 0, `low_stock` when below 10, else `in_stock`. `discount_percent` is a JSON number; money fields are strings.

## Cart pricing (no sign-in needed)

### `POST /api/v1/cart/validate`
Body: `{ items: [{ product_id, quantity }], coupon_code: string|null, shipping_method: "standard" }` (max 50 lines, quantity 1–999).
Answer `200`:
```json
{ "data": {
  "lines": [{ "product_id": 1, "name": "…", "sku": "…", "thumbnail_url": "…", "price": "9.99", "discount_percent": 10.48,
              "sale_price": "8.94", "quantity": 2, "line_total": "17.88", "stock_quantity": 99, "min_order_quantity": 1, "available": true }],
  "problems": [{ "product_id": 7, "code": "unavailable|insufficient_stock|below_minimum", "message": "…" }],
  "coupon": { "code": "NEST10", "description": "10% off your order" },
  "coupon_error": null,
  "shipping_options": [{ "id": "standard", "label": "Standard", "eta": "3–5 business days", "price": "0.00" }],
  "totals": { "item_count": 2, "subtotal": "17.88", "discount": "1.79", "shipping": "4.99", "tax": "0.00", "total": "21.08" }
} }
```
Unknown, draft, or deleted products come back with `available: false` and a problem; they are left out of the totals.

## Orders

### `POST /api/v1/orders` (guest, or customer with a Bearer access token)
Body:
```json
{ "items": [{ "product_id": 1, "quantity": 2 }], "coupon_code": "NEST10", "shipping_method": "standard", "payment_method": "cod",
  "email": "guest@example.com", "phone": "+15550100100",
  "shipping_address": { "first_name": "Ava", "last_name": "Customer", "line1": "12 Market Street", "line2": null,
                        "city": "Springfield", "state": "Oregon", "postal_code": "29112", "country": "United States" },
  "billing_address": null,
  "expected_total": "21.08" }
```
- Signed-in customers: the order belongs to them; `email` defaults to the account email.
- Validation 422 on fields (`shipping_address.postal_code`, `payment_method`, …). `country` must be one of the store's countries (`United States, Canada, United Kingdom, Australia, Germany, Bangladesh, India`).
- In one database transaction: lock the product rows, re-price, check stock (`insufficient_stock` → 422 with `errors.items` and `problems`), decrement stock, create the order, items, and first history entry.
- `expected_total` (optional): if the server total differs, nothing is created and the answer is **409** `{ message: "Prices changed since you added these items. Please review your order.", data: <cart/validate data> }`.
- Answer **201** `{ data: OrderResource }`; an order confirmation email goes to `email`.
- Rate limited (`throttle:orders`, 10 per minute per visitor).

### Customer
- `GET /api/v1/orders?page` → their orders, newest first (paginated OrderResource without `history`).
- `GET /api/v1/orders/{number}` → OrderResource; someone else's order → 404.

### Guest lookup
- `POST /api/v1/orders/lookup` `{ number, email }` → OrderResource when both match (case-insensitive email); otherwise 404 `{ message: "We couldn't find an order with that number and email." }` (same answer either way). Rate limited like sign-in.

**OrderResource**:
```json
{ "number": "BN-100001", "status": "processing", "payment_status": "unpaid", "payment_method": "cod",
  "shipping_method": { "id": "standard", "label": "Standard", "eta": "3–5 business days" },
  "email": "…", "phone": "…", "shipping_address": { … }, "billing_address": { … }, "coupon_code": "NEST10",
  "items": [{ "product_id": 1, "sku": "…", "name": "…", "thumbnail_url": "…", "price": "9.99", "discount_percent": 10.48,
              "sale_price": "8.94", "quantity": 2, "line_total": "17.88" }],
  "totals": { "item_count": 2, "subtotal": "17.88", "discount": "1.79", "shipping": "4.99", "tax": "0.00", "total": "21.08" },
  "placed_at": "2026-11-10T09:41:02Z",
  "history": [{ "status": "processing", "payment_status": "unpaid", "note": "Order placed.", "created_at": "…" }] }
```
`billing_address` equals `shipping_address` when none was given. Customers never see `admin_id` or internal notes marked private.

## Admin API (`/api/admin/v1`, admin token)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/overview` | `{ data: { products: { total, active, out_of_stock, low_stock, inventory_value }, orders: { total, revenue, units_sold, average_order, by_status: { processing: 3, … } }, customers: { total }, low_stock_products: [{ id, name, sku, category, stock_quantity, thumbnail_url }] (max 8, lowest first), latest_orders: [{ number, customer_name, email, items, total, status, placed_at }] (5), low_stock_threshold: 10 } }`. Revenue counts orders that aren't cancelled. |
| GET | `/products` | `search, category (slug), status, sort (name|price|stock|rating|newest), direction, page, per_page` → paginated AdminProductResource (ProductResource + `status, created_at, updated_at`), every status, deleted excluded |
| GET | `/products/{id}` | AdminProductResource with images |
| POST | `/products` | create: `name*, category* (slug), price*, stock_quantity*, sku (generated when empty), brand (name, created if new), description, discount_percent (0–90), status (default active), min_order_quantity, thumbnail_url, images: [url]` → 201 |
| PATCH | `/products/{id}` | any of the create fields (partial) → 200. Rules: name 2–120, price 0–1,000,000 with ≤ 2 decimals, stock 0–100,000 integer, discount 0–90 |
| DELETE | `/products/{id}` | soft delete → 204; past orders keep their snapshots |
| GET | `/categories` | `{ data: [{ id, slug, name, product_count }] }` |
| GET | `/orders` | `search (number, email, customer name), status, payment_status, page, per_page` → paginated AdminOrderResource (OrderResource + `id, customer: { id, name, email } | null (guest)`) newest first |
| GET | `/orders/{number}` | AdminOrderResource with full `history` (incl. `admin_name`) |
| PATCH | `/orders/{number}` | `{ status?, payment_status? ("paid"), note?, notify_customer? (default true) }`. Transition rules above; `cancelled` restocks; marking a `pending_payment` order paid moves it to `processing`. Adds a history entry; emails the customer when notified and the status changed. 422 for a disallowed transition. |

Validation messages are plain English sentences, shown as-is by the admin forms.

## Emails (Markdown-free Blade, like the code email)
- **Order confirmation** to the order email: number, items, totals, shipping address, payment method and what happens next.
- **Status update** (shipped, delivered, cancelled) when `notify_customer` is true.
Both appear in the local test inbox (`/dev/mailbox`).

## Sign-in service (frontend/server) routes for the browser

The browser keeps talking only to its own origin:

| Browser calls | Service forwards to | Notes |
| --- | --- | --- |
| `GET /api/catalog/products?…`, `/api/catalog/products/{id}`, `/api/catalog/categories` | `GET /api/v1/products…`, `/api/v1/categories` | public, `Cache-Control: public, max-age=60`; only these paths and the listed query keys are forwarded |
| `POST /api/shop/cart/validate` | `POST /api/v1/cart/validate` | |
| `POST /api/shop/orders` | `POST /api/v1/orders` | adds the customer's Bearer token when the customer cookie is present |
| `GET /api/shop/orders`, `GET /api/shop/orders/{number}` | customer endpoints | needs the customer session (401 otherwise) |
| `POST /api/shop/orders/lookup` | guest lookup | |
| `/api/admin/overview`, `/products…`, `/categories`, `/orders…` | the admin endpoints above | admin session; answers mapped to the shapes the admin app already uses (plus the new fields) |

With `VITE_API_PROVIDER=laravel` the storefront's catalog uses `/api/catalog/*` on its own origin (no CORS, no API URL in the browser bundle).

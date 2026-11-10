# BuyNest API (Laravel)

The real backend for BuyNest: customer accounts, shop staff accounts, the catalog, cart pricing, orders, invoices, shipments, refunds, and coupons. Laravel 13, MySQL, Sanctum tokens.

The browser never calls this API directly. The storefront's **sign-in service** (`frontend/server/`) calls it from the server and keeps the tokens in HttpOnly cookies, so no page script can ever read a token. How it all fits: [docs/backend/ACCOUNTS.md](../docs/backend/ACCOUNTS.md).

## What's here (phase 1: accounts)

| Area | What it does |
| --- | --- |
| Customer sign-up | First name, last name, email, phone, password. The account starts **unconfirmed**; a 6-digit code is emailed. |
| Email codes | 6 digits, expire in 10 minutes, 5 wrong tries then locked, one new code per minute, used once. Only a keyed hash is stored. |
| Sign-in | Only confirmed, active customers. Wrong password and unknown email get the same answer. |
| Password reset | Code by email (same answer for unknown emails), then a new password; every device is signed out. |
| Tokens | Access token (60 min) + refresh token (1 day, or 7 with "Keep me signed in"). Refresh swaps the pair; the old one stops working. |
| Admins | A separate `admins` table, separate sign-in, separate tokens. A customer can never sign in to the admin, even with the right password. |
| Customers in the admin | List, search, filter by status, block/unblock. Blocking signs the customer out everywhere. |
| Clean-up | Unconfirmed sign-ups are deleted after 7 days (`model:prune`, scheduled daily). |

## What's here (phase 2: catalog and orders)

The agreement with the storefront and admin: [docs/backend/PHASE2_CONTRACT.md](../docs/backend/PHASE2_CONTRACT.md).

| Area | What it does |
| --- | --- |
| Catalog | Categories, brands, products (soft deletes), images, reviews in MySQL. Imported once from DummyJSON (194 products, same ids). Only `active` products are public. |
| Server pricing | Carts and orders send product ids and quantities, never prices. `App\Services\Pricing` is the only money code (integer cents) and rounds exactly like the storefront's `cartTotals.js`. |
| Store rules | Shipping, countries, payment methods, low stock threshold: `config/buynest.php` (`store`). Coupons are in the database since phase 3. |
| Orders | Guests and customers. One transaction locks the products, re-prices, checks and takes the stock. Numbers are `BN-` + (100000 + id). Items are snapshots. Confirmation email. |
| Order status | `pending_payment → processing → shipped → delivered`; `cancelled` from the first two puts the stock back. Card/PayPal start `pending_payment`; cash on delivery starts `processing`. Marking paid moves `pending_payment` to `processing`. |
| Admin | Overview numbers, product create/edit/delete, categories, order list/detail/status changes with history (who did it) and customer emails for shipped, delivered, cancelled. |

## What's here (phase 3: invoices, shipments, refunds, coupons)

The agreement: [docs/backend/PHASE3_CONTRACT.md](../docs/backend/PHASE3_CONTRACT.md). Modeled on Magento's order workflow.

| Area | What it does |
| --- | --- |
| Invoices | `INV-` + (100000 + id). Records the payment of the full grand total (one per order): payment `paid`, `pending_payment → processing`. Refused for cancelled or already invoiced orders. "Payment received" email. |
| Shipments | `SHP-…`, carrier (`dhl, fedex, ups, usps, other`) and tracking number; tracking links for the known carriers. Only from `processing`; card/PayPal must be invoiced first, cash on delivery may ship unpaid. "Your order is on its way" email. |
| Credit memos | `CM-…`: refund items, shipping, and an adjustment (negative = a fee kept), optional restock. Integer cents: each line's share of the coupon is proportional to its line total (leftover cents go to the largest dropped fractions, so shares add up exactly); every unit is worth `floor(line paid / quantity)` and the line's last refundable unit takes the remainder, so a full refund equals exactly what was paid. Payment becomes `partially_refunded` or `refunded`; a full refund closes the order (`closed`, final). "Refund for order …" email. |
| Orders | Totals gain `paid` and `refunded`; order resources list invoices, shipments, credit memos. Cancelling is refused once invoiced (refund instead). PATCH still accepts `payment_status: "paid"` (creates the invoice, no email) and `status: "shipped"` (creates a shipment without tracking) for phase 2 clients. |
| Coupons | `percent`, `fixed`, `free_shipping` (every shipping method free). Minimum subtotal, start/end dates, total and per-customer limits (customer id, or email for guests). Checked in a fixed order, first failure wins. A use is counted inside the checkout transaction with the coupon row locked, and given back when the order is cancelled. NEST10 and SAVE20 are seeded by the migration. |

## Endpoints

Storefront (customers), `/api/v1`:

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/auth/register` | `first_name, last_name, email, phone, password, password_confirmation, accept_terms` → 201, code emailed |
| POST | `/auth/verify-email` | `email, code, remember` → `{ customer, tokens }` |
| POST | `/auth/resend-code` | `email, purpose` (`verify_email` / `reset_password`) → same answer for every email |
| POST | `/auth/login` | `email, password, remember` → `{ customer, tokens }`; unconfirmed → 403 `email_unverified` |
| POST | `/auth/refresh` | `refresh_token` → new pair |
| POST | `/auth/forgot-password` | `email` → same answer for every email |
| POST | `/auth/reset-password` | `email, code, password, password_confirmation` |
| POST | `/auth/logout` | access token → this device signed out |
| GET / PATCH | `/me` | profile; PATCH changes `first_name, last_name, phone` (not the email) |
| GET | `/products` | public; `search, category, brand[], min_price, max_price` (sale price), `min_rating, available=1, sort` (`price, rating, discount, name, newest`), `direction, page, per_page` (12, max 100) |
| GET | `/products/{id}` | public; with `images` and `reviews`; drafts, archived, deleted → 404 `Product not found.` |
| GET | `/categories` | public; categories with active products |
| POST | `/cart/validate` | public; `items[{product_id, quantity}], coupon_code, shipping_method, email?` → lines, problems, coupon, shipping options, totals. Optional customer Bearer token (per-customer coupon limits; a bad token → 401) |
| POST | `/orders` | guest, or customer Bearer token (any other token → 401/403); `items, coupon_code, shipping_method, payment_method, email, phone, shipping_address, billing_address, expected_total` → 201; 422 with `problems` for stock; 409 when `expected_total` differs. 10 per minute per visitor |
| GET | `/orders` | customer; their orders, newest first |
| GET | `/orders/{number}` | customer; someone else's → 404. Includes `invoices`, `shipments`, `credit_memos` |
| GET | `/orders/{number}/invoices/{invoice}` | customer; the printable invoice (own orders only, else 404) |
| POST | `/orders/lookup` | guest; `number, email` → the order, or the same 404 whichever is wrong (limited like sign-in) |

Admin (shop staff), `/api/admin/v1`, admin token only (a customer token gets 403):

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/auth/login`, `/auth/refresh`, `/auth/logout` | as for customers |
| GET | `/me` | the signed-in admin |
| GET / PATCH | `/customers`, `/customers/{id}` | `search, status, page, per_page`; PATCH `is_active` |
| GET | `/overview` | products, orders (revenue excludes cancelled), customers, low stock products, latest orders |
| GET / POST | `/products` | list every status (`search, category, status, sort, direction, page, per_page`); create → 201 |
| GET / PATCH / DELETE | `/products/{id}` | detail with images; partial update; soft delete → 204 |
| GET | `/categories` | with `product_count` |
| GET | `/orders` | `search` (number, email, name), `status, payment_status, page, per_page` |
| GET / PATCH | `/orders/{number}` | detail with history and documents; PATCH `status, payment_status: "paid", note, notify_customer` (cancel refused once invoiced) |
| POST | `/orders/{number}/invoices` | `note, notify_customer` → 201 InvoiceResource |
| POST | `/orders/{number}/shipments` | `carrier, tracking_number, note, notify_customer` → 201 ShipmentResource |
| GET | `/orders/{number}/refundable` | per item `ordered, refunded, refundable, unit_refund`; `shipping_refundable`, `max_total` |
| POST | `/orders/{number}/credit-memos` | `items[{order_item_id, quantity}], shipping_refund, adjustment, restock, note, notify_customer` → 201 CreditMemoResource |
| GET | `/invoices`, `/invoices/{number}` | `search` (invoice number, order number, email), `page, per_page` |
| GET | `/credit-memos`, `/credit-memos/{number}` | same |
| GET / POST | `/coupons` | `search, status` (`active, inactive, scheduled, expired, used_up`), `page, per_page`; create → 201 |
| GET / PATCH / DELETE | `/coupons/{id}` | partial update; DELETE: used coupons are only disabled (200), unused ones deleted (204) |

Errors follow Laravel: 401 `Unauthenticated.`, 403, 404, 422 `{ message, errors: { field: [...] } }`, 429 with `Retry-After`.

## Run it

Needs PHP 8.3+ (with mbstring, xml, curl, mysql, sqlite3, bcmath, intl, zip), Composer, and MySQL.

```bash
composer install
cp .env.example .env && php artisan key:generate
# set DB_* in .env, and BFF_SHARED_KEY (openssl rand -hex 32; the same value goes in frontend/.env.local as BUYNEST_BFF_KEY)
php artisan migrate --seed       # tables + local demo accounts + the demo catalog (downloaded once)
php artisan serve --port=8000
```

The catalog comes from DummyJSON: `php artisan buynest:import-catalog` downloads it and adds or updates every product by SKU, keeping DummyJSON's ids. Run it again whenever you like: the shop's own fields (price, discount, stock, status) are kept, so staff edits and stock taken by orders survive. `--overwrite` resets those too. `db:seed` runs it in local development when there are no products yet.

Or start everything from the repository root with `./dev.sh`.

Local demo accounts (`php artisan db:seed`, local only):

| Who | Email | Password |
| --- | --- | --- |
| Shop admin | admin@buynest.test | AdminPass2026 |
| Customer | customer@buynest.test | CustomerPass2026 |
| Second customer | shopper2@buynest.test | ShopperPass2026 |

Create a real admin (the only way; the storefront can't): `php artisan buynest:create-admin you@example.com --name="Your Name"`.

## Email

In development (`APP_ENV=local`, `MAIL_MAILER=log`, `DEV_MAILBOX=true`) every email is kept in a **test inbox**: open http://127.0.0.1:8000/dev/mailbox to read the codes, order confirmations, order status, payment, shipment, and refund emails. Nothing reaches real people. That page doesn't exist outside local development.

For real email, change only the settings: `MAIL_MAILER=smtp` with `MAIL_HOST`, `MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD` (or a provider such as Mailgun, Postmark, or SES), and `DEV_MAILBOX=false`.

## Tests

```bash
php artisan test     # 106 feature tests, against the buynest_test database (no network: products come from factories)
vendor/bin/pint      # code style
```

## Production checklist

- `APP_ENV=production`, `APP_DEBUG=false`, `DEV_MAILBOX=false`, a real mailer.
- A strong `BFF_SHARED_KEY`, shared only with the storefront's server functions.
- Don't expose this API publicly if you don't need to: only the storefront's server calls it.
- Run the scheduler (`php artisan schedule:run` every minute) so unconfirmed sign-ups are cleaned up.

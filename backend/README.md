# BuyNest API (Laravel)

The real backend for BuyNest: customer accounts, shop staff accounts with roles, the catalog, cart pricing and tax, orders, invoices, shipments, refunds, coupons, content pages, reports, and store settings. Laravel 13, MySQL, Sanctum tokens.

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
| Store rules | Shipping, countries, payment methods, low stock threshold: database settings since phase 4 (`App\Services\Settings`). Coupons are in the database since phase 3. |
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

## What's here (phase 4: roles, audit log, content, reports, settings)

The agreement: [docs/backend/PHASE4_CONTRACT.md](../docs/backend/PHASE4_CONTRACT.md). Modeled on Magento's System → Permissions, Content, Reports, and Stores → Configuration.

| Area | What it does |
| --- | --- |
| Roles and permissions | Every admin has a role; a role is a list of permission keys (`App\Support\Permissions`). **Every** admin route checks one with `can.admin:<key>` (a test fails if a route forgets). Missing → 403 `{ message: "Your role doesn't allow this.", code: "permission_denied", permission }`. Seeded: **Owner** (built in: every key, can't be edited or deleted), Sales staff, Catalog manager (since phase 5 also import/export and reviews), Marketing, Viewer (every `*.view`). Existing admins became Owners. |
| Admin users | Create (password: 12+ characters, letters and numbers), edit, deactivate, reset password. You can't deactivate or change the role of your own account; only an Owner can give the Owner role or change an Owner; there is always an active Owner. Deactivating or resetting a password signs that admin out everywhere. Admins are never deleted. |
| Audit log | Who did what: products, orders (status, notes), invoices, shipments, credit memos, customers (block/unblock), coupons, pages, home content, settings, admins, roles, sign-ins, and failed sign-ins (no admin; the email tried is in the summary). `changes` holds only the changed fields, `{ before, after }`; passwords and tokens never. |
| Content | Pages (`about`, `shipping-and-returns`, `privacy`, `terms`, `contact` seeded). The body is HTML **sanitized on save** with `symfony/html-sanitizer` and an allow-list (no scripts, styles, iframes, event attributes, or `javascript:` links; links get `rel="noopener"`). Home page content (hero, banners, featured products), seeded from the storefront's old `homeContent.js`. |
| Reports | Sales (every day/week/month present, refunds subtracted), best sellers, customers, coupons, low stock; sales and best sellers also as CSV (cells that could run as spreadsheet formulas get a `'`). Up to 366 days, default the last 30. |
| Settings | General, shipping, tax, checkout, inventory, kept in the `settings` table, read through the cache (cleared on save). Cart pricing and checkout follow them: shipping prices and threshold, which shipping and payment methods are on, countries, guest checkout, tax. |
| Tax | Off by default. When on: the shipping country's rate × (merchandise after the discount + shipping), rounded to the cent. `cart/validate` takes an optional `country` (without it tax is 0 and `tax_estimated` is false). With `prices_include_tax` the tax is shown but already inside the prices. Refunds: tax added on top is shared over the lines and shipping like the coupon, so a unit's refund includes its tax and a full refund is exactly the grand total. |

## What's here (phase 5: Magento-style catalog management)

The agreement: [docs/backend/PHASE5_CONTRACT.md](../docs/backend/PHASE5_CONTRACT.md) (its "Implementation notes" list every shape the contract left open). Modeled on Magento's Catalog → Categories / Products, Data transfer, and Marketing → Reviews.

| Area | What it does |
| --- | --- |
| Category tree | `parent_id`, at most 3 levels, no cycles (422), unique lower-case slugs. Description, active flag, meta title/description. A category is visible when it and all its ancestors are active; products in a hidden category are left out of the store (listing, search, product page, cart). `?category=` includes subcategories. Deleting is refused while a category has subcategories or products (the message gives the count). |
| Image uploads | JPEG, PNG, WebP only, **judged by the bytes** (finfo and getimagesize must agree), at most 5 MB and 6000×6000 px, 10 per upload, 12 per product. Stored on the `public` disk as `products/{id}/{32 random hex}.{ext}` (never the uploaded name); the url is `/media/products/{id}/{name}`, which the sign-in service streams from `/storage/...`. No GD/Imagick is needed: files aren't re-encoded. The thumbnail follows the first image. |
| Options and variants | Up to 3 options × 20 values; variants per combination with their own SKU (unique across products and variants), stock, optional price, active flag (max 200 per product). A product with options sells only through an active variant; its stock is the sum of its active variants' stock. Checkout locks the product and the variant rows; order items remember `variant_id` and `variant_label`; refunds and cancellations restock the variant. |
| Mass actions | `POST /products/bulk`: enable, disable, archive, delete, set category, adjust price (percent or fixed), set stock. One transaction, one audit entry per product. |
| Import / export | CSV with `sku,name,category_slug,brand,price,discount_percent,stock_quantity,status,description,tags,image_urls`. Import checks every row first (dry run by default); any error saves nothing. Export cells that could run as formulas get a `'`. |
| Reviews | Customers write one review per product (plain text, 10 per hour); `verified_purchase` when they have a non-cancelled order with it. Staff approve/reject/delete; only approved reviews are public and `rating_average` / `review_count` follow them. Settings → Catalog → `reviews_require_approval` (default on). |

## What's here (phase 6: Magento-style customers and sales)

The agreement: [docs/backend/PHASE6_CONTRACT.md](../docs/backend/PHASE6_CONTRACT.md) (its "Implementation notes" list every shape the contract left open). Modeled on Magento's Customers → All customers / Customer groups, the address book, Sales → Orders → Create new order, Sales → Shipments, Returns (RMA), and the order grid's mass actions.

| Area | What it does |
| --- | --- |
| Address book | Up to 20 addresses per customer (store: `/me/addresses`; admin: `/customers/{id}/addresses`), one default shipping and one default billing (the first address gets both). Country must be one the store ships to. Checkout's `save_address: true` adds the shipping address unless the book is full or already has it. `App\Services\AddressBook`. |
| Customer groups | General (built in, 0%, new sign-ups and guests), Wholesale (10%), VIP (5%); staff add more (0–90%). The group discount comes off every line's sale price after the product discount and before coupons, in the cart, at checkout, and in admin orders (`Pricing::quote(..., group:)`). Orders keep the group name and each line's `group_discount_percent`; `sale_price` is after it, so refunds are unchanged. A group with customers can't be deleted. |
| Customers in the admin | Full profile (addresses, orders, lifetime spent, reviews, staff notes), edit (a new email is unverified and signs the customer out), create (no password: a "Set your password" email with a reset code), send a password reset, delete (refused while an order is open; orders and reviews stay without the link), CSV export, filters by group, status, verified, sign-up date. Staff never see or set a password. Accounts staff created are never pruned as abandoned sign-ups. |
| Phone orders | `POST /orders/quote` and `POST /orders` in the admin use the storefront's `Checkout` service (prices, group discount, coupons, tax, stock with row locks). Staff may also choose `bank_transfer` (waits for payment) and `cash` (like cash on delivery). Orders have `source` (`storefront`/`admin`) and who created them. |
| Shipments and packing slips | A shipments list (carrier, dates, search by shipment, tracking, or order number) and detail; `GET /orders/{number}/packing-slip` (items, quantities, variant labels, ship-to; no prices). |
| Returns (RMA) | `RMA-…`. Customers request returns for shipped/delivered orders inside the window (Settings → Returns: on/off, days, reasons), at most what was shipped minus what's already returned or refunded. `requested → approved/rejected → received → refunded/closed`; receiving can restock; "Refund this return" is a credit memo with `return_number` (the return becomes refunded and is never restocked twice). Staff can create returns and override the window. Every change notes the order history and emails the customer. `App\Services\Returns`. |
| Order grid | Mass invoice, ship (carrier, no tracking), cancel: each order on its own, answer `{ done, skipped: [{ number, reason }] }`; each action checks its own permission. CSV export with the grid's filters. |

Uploads need the public storage link once: `php artisan storage:link` (creates `public/storage`, git-ignored; uploaded files in `storage/app/public` are git-ignored too).

## What's here (phase 7, part B: newsletter, email templates, SEO, carts, dashboard)

The agreement: [docs/backend/PHASE7_CONTRACT.md](../docs/backend/PHASE7_CONTRACT.md) ("Implementation notes — part B" has every shape).

| Area | What it does |
| --- | --- |
| Newsletter | Double opt-in: `POST /api/v1/newsletter` always answers 202 with the same message; the email has a confirm link (7 days); every newsletter has a signed unsubscribe link and a `List-Unsubscribe` header. Customers toggle it in Account (`PATCH /me { newsletter }`). Campaigns (sanitized HTML) are sent by queued `SendNewsletterBatch` jobs, 100 per batch (`QUEUE_CONNECTION=sync` in development runs them at once; with a real queue run `php artisan queue:work`). `App\Services\Newsletter`. |
| Email templates | Every email renders from a template (`App\Support\EmailTemplateCatalog` = defaults in code, `email_templates` = staff changes) through `App\Services\EmailTemplates`: `{{ variables }}` from a fixed list per template, text escaped, prebuilt blocks (`items_table`, `address`, `button`, …) from `App\Support\EmailBlocks`, the store frame in `resources/views/emails/layout.blade.php`, plain text made from the HTML. Preview, test send, reset to default. |
| SEO | Product `meta_title`/`meta_description`; `GET /api/v1/sitemap.xml` (cached 15 min, links use `STOREFRONT_URL`); URL redirects (`/redirects` admin with CSV import, public lookup `GET /api/v1/redirects?path=`). |
| Saved and abandoned carts | `POST /cart/validate` with a customer token saves the cart; an order marks it converted. `GET /me/cart` and `POST /me/cart/merge` restore it on another device. Reports → Abandoned carts (idle ≥ 1 hour) and a reminder email (once per 72 hours, active customers only). `App\Services\CustomerCarts`. |
| Dashboard and notifications | `/overview` blocks depend on the admin's `*.view` keys. The bell (`/notifications`) gets low stock / out of stock, customer return requests, reviews waiting, failed newsletter batches (model events in `App\Providers\MarketingServiceProvider`), filtered by permission, one unread per subject. `/preferences/{key}` keeps each admin's grid columns, page size, and saved filters. |

## What's here (phase 8: Stripe card payments, real email)

The agreement: [docs/backend/PHASE8_CONTRACT.md](../docs/backend/PHASE8_CONTRACT.md) ("Implementation notes — backend" has every shape).

| Area | What it does |
| --- | --- |
| Card payments | With `STRIPE_SECRET_KEY` set, a card order gets a **Stripe Checkout** page for its grand total (`data.payment.url` on the order answer); card details never reach BuyNest. `POST /api/v1/orders/{number}/pay` opens a new page (Pay now). Staff get a payment link for card orders they create (`POST /api/admin/v1/orders/{number}/payment-link`). Without the key everything works as before (staff invoice card orders by hand). No Stripe SDK: `App\Services\Payments\StripeGateway` uses Laravel's HTTP client. |
| Webhook | `POST /api/v1/payments/stripe/webhook`, signed with `STRIPE_WEBHOOK_SECRET` (checked: HMAC, 5-minute window). Paid → the invoice is created (and emailed) like a staff invoice; page expired unpaid → the order is cancelled (stock and coupon back, "Payment not completed" email); amounts that don't match → order left unpaid + a critical admin notification. Each event is handled once (`stripe_events`, since phase 10 `payment_events`). `App\Services\Payments\StripePayments`. |
| Refunds | A credit memo on a Stripe-paid order refunds the card first (`refund_reference`); Stripe refusing → 422 and nothing saved. |
| Email | `php artisan buynest:mail-test you@example.com` sends a test email through the configured mailer. |

### Permissions

| Area | Keys |
| --- | --- |
| Dashboard | `dashboard.view` |
| Catalog | `products.view` (also the category tree), `products.edit` (also images, options, variants, mass actions), `products.delete` (also the bulk `delete`), `categories.edit`, `products.import` (CSV import and export), `reviews.view`, `reviews.moderate` |
| Sales | `orders.view` (orders, invoices, credit memo and shipment lists, refundable amounts, packing slips, order export, the bulk route), `orders.edit`, `invoices.create`, `shipments.create`, `credit_memos.create`, `orders.create` (phone orders and their quote), `returns.view`, `returns.manage` |
| Customers | `customers.view` (also groups, addresses, notes, export), `customers.edit` (account, addresses, notes, password reset, block), `customers.create`, `customers.delete`, `customer_groups.manage` |
| Marketing | `coupons.view`, `coupons.edit`, `newsletter.view`, `newsletter.send` (campaigns, unsubscribing, cart reminders), `gift_cards.view`, `gift_cards.manage` (phase 10) |
| Content | `content.view`, `content.edit`, `email_templates.manage` (Owner-only by default), `seo.manage` (redirects, search terms) |
| Reports | `reports.view` |
| Settings | `settings.view`, `settings.edit` |
| System | `admins.manage` (admin users, roles, the permission list), `audit.view` |

Signing in, refreshing, signing out, and `GET /me` need no permission; nor do `/notifications…` (filtered by each notification's permission) and `/preferences/{key}` (the admin's own).

## What's here (phase 9, part A: two-step sign-in, customer self-service)

The agreement: [docs/backend/PHASE9_CONTRACT.md](../docs/backend/PHASE9_CONTRACT.md) ("Implementation notes — part A" has every shape).

| Area | What it does |
| --- | --- |
| Two-step sign-in (admins) | Authenticator-app codes (TOTP, RFC 6238, written in `App\Services\TwoFactor`, tested against the RFC's vectors). Secret encrypted at rest, 10 hashed one-time recovery codes, replay guard, a 5-minute challenge that burns after 5 wrong codes. QR code drawn on the server as SVG (`bacon/bacon-qr-code`). Account → Two-step sign-in: `POST/DELETE /me/two-factor`, `/me/two-factor/confirm`, `/me/two-factor/recovery-codes`. |
| Required for every admin | Settings → Security `require_admin_two_factor` (Owner only, and only once the Owner uses it). Admins without it get a limited token that reaches only `GET /me`, logout and the setup (`token.kind:admin,setup`); everything else answers 403 `two_factor_setup_required`. The Owner can reset someone's two-step sign-in (`POST /admins/{id}/two-factor/reset`), which signs them out everywhere. |
| Change email | `POST /api/v1/me/email` sends a code to the new address; `/me/email/confirm` switches it, signs out other devices, and tells the old address. |
| Cancel my order | `POST /api/v1/orders/{number}/cancel` (owner, or a guest with the order's email) while it's unpaid and not shipped; uses the staff cancel. Orders answer `can_cancel`. |
| My data | `GET /api/v1/me/export` (a JSON file, 3 per hour), `POST /api/v1/me/delete` (`password`, `confirm: "DELETE"`; same rules as staff deletion, `App\Services\CustomerAccounts`). |
| Emails | New templates `email_change_code`, `email_changed`, `order_cancelled_by_customer`, `account_deleted`. |

## What's here (phase 9, part B: photo sizes, error alerts, backups, stock alerts)

- **Resized photos:** uploads get 320 and 960 px wide WebP copies when GD is installed (`app/Services/ImageResizer.php`, rules in `app/Support/ImageVariants.php`); image items and products gain `variants` / `thumbnail_variants` for `srcset`. `php artisan buynest:images:resize [--force]` for older uploads.
- **Error alerts:** Sentry (`sentry/sentry-laravel`) only when `SENTRY_LARAVEL_DSN` is set; `app/Support/SentryScrubber.php` keeps personal data out. Browser errors arrive at `POST /api/v1/client-errors` from the sign-in service (shared key always required).
- **Backups:** `php artisan buynest:backup [--list]` (gzipped `mysqldump`, password in a temporary 0600 file, never on the command line) to the `backups` disk (`BACKUP_DISK=local|s3`), daily at 03:00, `BACKUP_KEEP_DAYS` kept; admin System → Backups (`backups.view`, Owner only) with signed 5-minute downloads. Restore: `docs/DEPLOY_RAILWAY.md` step 15.
- **Back in stock:** `POST /api/v1/products/{id}/stock-alerts` (always 202), queued `back_in_stock` emails whenever stock returns (one model-event hook in `app/Providers/LaunchServiceProvider.php`), a signed "stop these alerts" link, Account → Stock alerts, and Reports → Stock alerts.
- Shapes: `docs/backend/PHASE9_CONTRACT.md`, "Implementation notes — part B".

## What's here (phase 10, part A: better search, PDF documents, analytics setting)

- **Search:** a MySQL FULLTEXT index on products (name, description, and `search_text` = brand, category, tags, SKUs) ranks results when no sort is chosen (exact SKU, exact name, name matches, then relevance, then rating). A misspelled word ("ihpone") is corrected to the closest word in `search_vocabulary` and the answer says so in `meta.corrected_query`; `correct=0` searches exactly as typed. Real words are never "corrected". `app/Services/CatalogSearch.php` (matching, ranking, corrections) and `SearchIndex.php` (kept in step by `app/Providers/SearchServiceProvider.php`). Rebuild by hand with `php artisan buynest:search:reindex` (also daily at 04:10, and automatically after catalog changes).
- **PDF invoices and credit memos:** `barryvdh/laravel-dompdf` draws `resources/views/documents/*.blade.php` (DejaVu Sans, nothing loaded from the network). Downloads for the storefront (owner's token or `?email=`) and the admin; the "payment received" email attaches the invoice. Settings → Documents: `paper_size` (a4/letter), `attach_pdf_to_emails`.
- **Analytics:** Settings → Analytics `ga4_measurement_id` (`G-…`, empty = off), public in `GET /api/v1/store`; the storefront asks for cookie consent before loading Google Analytics.
- Shapes: `docs/backend/PHASE10_CONTRACT.md`, "Implementation notes — part A".

## What's here (phase 10, part B: PayPal, shipping table rates, gift cards)

- **PayPal:** with `PAYPAL_CLIENT_ID` + `PAYPAL_CLIENT_SECRET` set, a PayPal order gets a PayPal approval link (Orders API v2, redirect; `data.payment.url`); back on the confirmation page the storefront calls `POST /api/v1/orders/{number}/paypal/capture { token }` and the API captures and invoices it. Webhook `POST /api/v1/payments/paypal/webhook` (verified by PayPal's verify-webhook-signature API with `PAYPAL_WEBHOOK_ID`), Pay now and staff payment links, refunds through PayPal, and `php artisan buynest:payments:expire-paypal` (every 5 minutes) cancels orders left unpaid for 3 hours. No SDK: `App\Services\Payments\PayPalGateway` (HTTP client, cached OAuth token, `PayPal-Request-Id` on every POST); `OnlinePayments` picks Stripe or PayPal per order. Webhook events of both providers are kept in `payment_events` (provider + id). Without the keys PayPal orders wait for staff, as before.
- **Shipping table rates:** `shipping_rates` rows (method, country, weight and subtotal ranges, price) price a method by the cart's weight (product or variant `weight` in grams, else Settings → Shipping `default_weight_grams`); a method with rows but no matching row isn't offered; methods without rows keep their flat price; free shipping still applies on top. Cart validation, checkout, and admin orders all use it (`App\Services\ShippingRates`, inside `Pricing::quote`). Admin: `/shipping-rates` CRUD, reorder, CSV import/export, and a "check a cart" tool.
- **Gift cards:** gift card products (`type: "gift_card"`, `gift_card_amounts`, optional custom range) sold with recipient details; cards are created and emailed (`gift_card_received`, buyer copy `gift_card_purchased`) only when the order is paid. Codes are random (16 characters, no look-alikes), stored as SHA-256 + last 4. `gift_card_code` at checkout pays up to the total (`payment_method: "gift_card"` when it covers everything), balances change only under a row lock with a transaction row each, cancelling gives the amount back, refunds return to the card first. `POST /api/v1/gift-cards/check` (rate-limited, one answer for unknown/disabled/expired). Admin: Marketing → Gift cards (`gift_cards.view`, `gift_cards.manage`) and `GET /reports/gift-cards`. `App\Services\GiftCards`.
- Shapes: `docs/backend/PHASE10_CONTRACT.md`, "Implementation notes — part B".

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
| GET / PATCH | `/me` | profile with `group { name, discount_percent }`; PATCH changes `first_name, last_name, phone` (not the email) |
| GET / POST | `/me/addresses` | the address book (max 20; first address = both defaults) → 201 |
| PATCH / DELETE | `/me/addresses/{id}` | own addresses only (else 404) |
| POST | `/orders/{number}/returns` | customer; `items[{order_item_id, quantity}], reason, comment` → 201; own shipped/delivered orders inside the window |
| GET | `/returns`, `/returns/{number}` | customer; own returns only |
| GET | `/products` | public; `search, category` (with its subcategories), `brand[], min_price, max_price` (sale price), `min_rating, available=1, sort` (`price, rating, discount, name, newest`), `direction, page, per_page` (12, max 100); items have `has_variants`, `review_count` |
| GET | `/products/{id}` | public; with `images`, approved `reviews`, `options` and active `variants`; drafts, archived, deleted, or in a hidden category → 404 `Product not found.` |
| POST | `/products/{id}/reviews` | customer; `rating, title?, comment` → 201 (`pending` unless approval is off); second review → 422 `already_reviewed`; 10 per hour |
| GET | `/categories` | public; the visible tree (`children`), branches with something to buy |
| GET | `/home` | public; `{ hero, banners (active, by position), featured_products [products] }` |
| GET | `/pages/{slug}` | public; published pages only, else 404 |
| GET | `/store` | public; store name, support contacts, enabled shipping methods with prices, free-shipping threshold, countries, payment methods, guest checkout, tax on/off, returns on/off, return window days, return reasons |
| POST | `/cart/validate` | public; `items[{product_id, variant_id?, quantity}], coupon_code, shipping_method, email?, country?` → lines (`sale_price` after the group discount, `base_sale_price`, `group_discount_percent`), problems, coupon, shipping options, totals (+ `group_discount`), `tax_estimated`, `customer_group`. Optional customer Bearer token (per-customer coupon limits, group price; a bad token → 401) |
| POST | `/orders` | guest, or customer Bearer token (any other token → 401/403); `items, coupon_code, shipping_method, payment_method, email, phone, shipping_address, billing_address, expected_total` → 201; 422 with `problems` for stock, or for a shipping/payment method or country that is off; 409 when `expected_total` differs; 403 `guest_checkout_disabled` for guests when guest checkout is off. 10 per minute per visitor |
| GET | `/orders` | customer; their orders, newest first |
| GET | `/orders/{number}` | customer; someone else's → 404. Includes `invoices`, `shipments`, `credit_memos`, `returns`, `return_eligibility` |
| GET | `/orders/{number}/invoices/{invoice}` | customer; the printable invoice (own orders only, else 404) |
| GET | `/orders/{number}/invoices/{invoice}.pdf` | Phase 10: the owner's token or `?email=` (the lookup's proof) → `INV-….pdf` (attachment); else the lookup's 404 |
| POST | `/orders/lookup` | guest; `number, email` → the order, or the same 404 whichever is wrong (limited like sign-in) |
| POST | `/orders/{number}/pay` | Phase 8: the order's customer (token) or `{ email }` (the lookup's proof) → `data.payment` `{ provider, url, expires_at, can_pay, paid_at }` (the open Stripe page, or a new one); 422 when it can't be paid online |
| POST | `/orders/{number}/cancel` | Phase 9: owner's token or `{ email }`, `reason?` → the order, cancelled; 422 once paid, invoiced, or shipped |
| POST | `/me/email`, `/me/email/confirm` | Phase 9: `email, password` → code to the new address; then `code` → switched |
| GET | `/me/export` | Phase 9: `buynest-my-data-YYYY-MM-DD.json` (3 per hour) |
| POST | `/me/delete` | Phase 9: `password, confirm: "DELETE"` → deleted (422 while an order is open) |
| POST | `/payments/stripe/webhook` | Stripe only (signed `Stripe-Signature`, raw body); 400 bad signature, else 200 `{ received, result }` |
| POST | `/orders/{number}/paypal/capture` | Phase 10: `{ token, email? }` after PayPal's approval → `{ data, result: "paid" \| "already_paid" }`; 422 `errors.payment` |
| POST | `/payments/paypal/webhook` | Phase 10: PayPal only (raw body + `PAYPAL-*` headers, verified with PayPal); 400 not verified, 503 PayPal unreachable, else 200 `{ received, result }` |
| POST | `/gift-cards/check` | Phase 10: `{ code }` → `{ last4, balance, currency, expires_at, status }`; one 422 for unknown, disabled, expired; 10 per minute |

Admin (shop staff), `/api/admin/v1`, admin token only (a customer token gets 403), and the permission in brackets ([Permissions](#permissions)):

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/auth/login`, `/auth/refresh`, `/auth/logout` | as for customers |
| GET | `/me` | the signed-in admin, with `role { id, name }` and `permissions [keys]` |
| GET / POST | `/customers` | [customers.view / customers.create] `search, status` (`active, blocked, verified, unverified`), `verified, group_id, created_from, created_to, page, per_page`; POST `first_name, last_name, email, phone, group_id?` → 201, "Set your password" email |
| GET | `/customers/export.csv` | [customers.view] the list filters |
| GET / PATCH / DELETE | `/customers/{id}` | [customers.view / customers.edit / customers.delete] full profile; PATCH `first_name, last_name, email, phone, group_id, is_active`; DELETE → 204 (422 while an order is open) |
| POST | `/customers/{id}/password-reset` | [customers.edit] emails a reset code (429 within a minute) |
| GET / POST | `/customers/{id}/addresses` | [customers.view / customers.edit] |
| PATCH / DELETE | `/customers/{id}/addresses/{address}` | [customers.edit] |
| GET / POST | `/customers/{id}/notes` | [customers.view / customers.edit] `body` (max 2000) → 201 |
| GET / POST | `/customer-groups` | [customers.view / customer_groups.manage] `name, code?, discount_percent` → 201 |
| PATCH / DELETE | `/customer-groups/{id}` | [customer_groups.manage] General can't be deleted or change code; a group in use can't be deleted |
| GET | `/overview` | products, orders (revenue excludes cancelled), customers, low stock products, latest orders |
| GET / POST | `/products` | list every status (`search, category, status, sort, direction, page, per_page`); create → 201 |
| GET / PATCH / DELETE | `/products/{id}` | detail with images; partial update; soft delete → 204 |
| GET | `/categories` | the tree with `product_count` (direct products) |
| POST / PATCH / DELETE | `/categories`, `/categories/{id}` | [categories.edit] tree rules above; DELETE 422 while it has subcategories or products |
| POST | `/categories/reorder` | [categories.edit] `parent_id, ids` → positions 0, 1, 2… |
| POST | `/products/{id}/images` | [products.edit] multipart `images[]` → 201 `[{ id, url, alt, position, is_upload }]` |
| PATCH / DELETE | `/products/{id}/images/{image}` | [products.edit] `alt`; DELETE also removes the file |
| POST | `/products/{id}/images/reorder` | [products.edit] `ids` (every image, in order) |
| PUT | `/products/{id}/options` | [products.edit] `options: [{ name, values }]` (replaces; `[]` = simple product) |
| POST | `/products/{id}/variants/generate` | [products.edit] creates missing combinations (inactive, stock 0); `meta.created` |
| PATCH | `/products/{id}/variants/{variant}` | [products.edit] `sku, price, stock_quantity, is_active` |
| POST | `/products/bulk` | [products.edit; `delete` also products.delete] `ids, action, value` → `{ updated, skipped }` |
| GET | `/products/export.csv` | [products.import] the product list filters |
| POST | `/products/import` | [products.import] multipart `file`, `dry_run` (default true) → `{ dry_run, rows, created, updated, unchanged, errors }` |
| GET | `/reviews` | [reviews.view] `status, product_id, rating, search, page, per_page`; `meta.counts` per status |
| PATCH / DELETE | `/reviews/{id}` | [reviews.moderate] `status` |
| POST | `/reviews/bulk` | [reviews.moderate] `ids, status` → `{ updated }` |
| GET | `/orders` | `search` (number, email, name), `status, payment_status, source, customer_id, page, per_page` |
| GET | `/orders/export.csv` | [orders.view] the grid's filters |
| POST | `/orders/quote` | [orders.create] the phone-order body → the cart/validate answer + `payment_methods` (nothing saved) |
| POST | `/orders` | [orders.create] `customer_id` or `guest`, `items, shipping_address, billing_address` or `same_as_shipping, shipping_method, payment_method` (+ `bank_transfer`, `cash`), `coupon_code, note, notify_customer, expected_total` → 201, `source: "admin"` |
| POST | `/orders/bulk` | [orders.view + the action's key] `numbers` (1–100), `action` (`invoice, ship, cancel`), `carrier` (ship), `notify_customer` → `{ done, skipped }` |
| GET | `/orders/{number}/packing-slip` | [orders.view] items, quantities, variant labels, ship-to; no prices |
| POST | `/orders/{number}/returns` | [returns.manage] like the customer's, plus `override_window, notify_customer` → 201 |
| GET | `/shipments`, `/shipments/{number}` | [orders.view] `carrier, from, to, search, page, per_page`; detail with items |
| GET | `/returns`, `/returns/{number}` | [returns.view] `status, search, page, per_page`; `meta.counts` per status |
| PATCH | `/returns/{number}` | [returns.manage] `status, admin_note, resolution, notify_customer, items[{return_item_id, condition}], restock` |
| GET / PATCH | `/orders/{number}` | detail with history and documents; PATCH `status, payment_status: "paid", note, notify_customer` (cancel refused once invoiced) |
| POST | `/orders/{number}/invoices` | `note, notify_customer` → 201 InvoiceResource |
| POST | `/orders/{number}/shipments` | `carrier, tracking_number, note, notify_customer` → 201 ShipmentResource |
| GET | `/orders/{number}/refundable` | per item `ordered, refunded, refundable, unit_refund`; `shipping_refundable`, `max_total` |
| POST | `/orders/{number}/credit-memos` | `items[{order_item_id, quantity}], shipping_refund, adjustment, restock, note, notify_customer, return_number?` → 201 CreditMemoResource (a received return becomes refunded, never restocked twice) |
| GET | `/invoices`, `/invoices/{number}` | `search` (invoice number, order number, email), `page, per_page` |
| GET | `/credit-memos`, `/credit-memos/{number}` | same |
| GET | `/invoices/{number}.pdf`, `/credit-memos/{number}.pdf` | [orders.view] Phase 10: the document as a PDF (attachment) |
| GET / POST / PATCH / DELETE | `/shipping-rates`, `/shipping-rates/{id}` | Phase 10: table rates; read [settings.view], change [settings.edit]; also POST `/shipping-rates/reorder`, `/shipping-rates/import` (CSV), `/shipping-rates/check` (country, weight, subtotal → prices) and GET `/shipping-rates/export.csv` |
| GET / POST / PATCH | `/gift-cards`, `/gift-cards/{id}` | Phase 10: read [gift_cards.view]; create (the code is shown once), PATCH `status, expires_at`, POST `/gift-cards/{id}/adjust` `amount, note` [gift_cards.manage]; GET `/reports/gift-cards` [reports.view] |
| GET / POST | `/coupons` | `search, status` (`active, inactive, scheduled, expired, used_up`), `page, per_page`; create → 201 |
| GET / PATCH / DELETE | `/coupons/{id}` | partial update; DELETE: used coupons are only disabled (200), unused ones deleted (204) |
| GET / POST | `/catalog-rules` | Phase 7 catalog price rules: `search, status, page, per_page` [coupons.view]; create [price_rules.manage] → 201 |
| GET / PATCH / DELETE | `/catalog-rules/{id}`, GET `/catalog-rules/{id}/preview` | read [coupons.view]; change [price_rules.manage]; preview = first 50 affected products with old and new price |
| GET / POST / PATCH / DELETE | `/search-terms`, `/search-terms/{id}` | [seo.manage] per-term redirects; report: GET `/reports/search-terms?type=top\|zero` [reports.view] |
| GET | `/newsletter/subscribers`, `/newsletter/subscribers/export.csv` | [newsletter.view] `status, source, search, page, per_page`; `meta.counts`; POST `/newsletter/subscribers/{id}/unsubscribe` [newsletter.send] |
| GET / POST / PATCH / DELETE | `/newsletter/campaigns`, `/newsletter/campaigns/{id}` | read [newsletter.view]; change drafts [newsletter.send]; POST `/{id}/test` (to yourself), `/{id}/send` → 202 |
| GET / PUT | `/email-templates`, `/email-templates/{key}` | [email_templates.manage] PUT `subject, body`; POST `/{key}/preview`, `/{key}/test`, `/{key}/reset` |
| GET / POST / PATCH / DELETE | `/redirects`, `/redirects/{id}`, POST `/redirects/import` | [seo.manage] |
| GET | `/reports/abandoned-carts` | [reports.view] `min_age_hours, max_age_days, min_subtotal, search, sort`; POST `/reports/abandoned-carts/{customer}/remind` [newsletter.send] |
| GET / POST | `/notifications`, `/notifications/{id}/read`, `/notifications/read-all` | (no key) `unread=1`, `meta.unread_count` |
| GET / PUT | `/preferences/{key}` | (no key) `products_grid`, `orders_grid`, `customers_grid` |
| GET / POST | `/admins` | [admins.manage] `search, role_id, status` (`active, inactive`), `page, per_page`; create `name, email, role_id, password, is_active?` → 201 |
| GET / PATCH | `/admins/{id}` | [admins.manage] PATCH `name, email, role_id, is_active` (the rules above → 422) |
| POST | `/admins/{id}/reset-password` | [admins.manage] `password` → signed out everywhere |
| GET / POST | `/roles` | [admins.manage] every role with `permissions, is_system, admins_count`; create `name, description, permissions` → 201 |
| PATCH / DELETE | `/roles/{id}` | [admins.manage] Owner → 422; a role in use can't be deleted (422 with the count) |
| GET | `/permissions` | [admins.manage] `[{ group, label, permissions: [{ key, label }] }]` |
| GET | `/audit` | [audit.view] `admin_id, action` (exact, or an area such as `product`), `subject_type, subject_id, from, to, page, per_page`; newest first |
| GET / POST | `/pages` | [content.view / content.edit] `search, status` (`published, draft`); create `slug, title, body, meta_title, meta_description, is_published` → 201 |
| GET / PATCH / DELETE | `/pages/{id}` | [content.view / content.edit] the body is sanitized on save; DELETE → 204 |
| GET / PUT | `/home` | [content.view / content.edit] `{ hero, banners, featured_product_ids }`, replaced as a whole; GET adds `featured_products` (names for the picker) |
| GET | `/reports/sales`, `/reports/sales.csv` | [reports.view] `from, to, group_by` (`day, week, month`) |
| GET | `/reports/products`, `/reports/products.csv` | [reports.view] best sellers; `from, to, limit` (10, max 100) |
| GET | `/reports/customers`, `/reports/coupons`, `/reports/low-stock` | [reports.view] |
| GET / PATCH | `/settings` | [settings.view / settings.edit] `{ general, shipping, tax, checkout, inventory, catalog, returns }`; PATCH `{ group: { key: value } }`, errors as `group.key` |
| POST | `/orders/{number}/payment-link` | [orders.edit] Phase 8: the Stripe payment link (open, or a new one for 24 hours) for an unpaid card order → `data.payment.url` |
| POST | `/auth/two-factor` | Phase 9: `challenge`, `code` or `recovery_code`, `remember` → `{ admin, tokens }` (after a login answered `two_factor_required`) |
| POST / DELETE | `/me/two-factor` | Phase 9: start setup → `{ secret, otpauth_url, qr_svg }`; turn off with `password, code` |
| POST | `/me/two-factor/confirm`, `/me/two-factor/recovery-codes` | Phase 9: `code` → on + 10 recovery codes; `password` → a new set |
| POST | `/admins/{id}/two-factor/reset` | [admins.manage] Phase 9, Owner only: turns it off and signs them out |

The older routes need: `/overview` dashboard.view; `/categories`, GET `/products…` products.view; POST/PATCH `/products` products.edit, DELETE products.delete; GET `/orders…`, `/invoices…`, `/credit-memos…`, `/refundable` orders.view; PATCH `/orders/{number}` orders.edit; POST invoices/shipments/credit-memos their `*.create`; `/coupons` coupons.view / coupons.edit.

Errors follow Laravel: 401 `Unauthenticated.`, 403 (`permission_denied` when the role doesn't allow it), 404, 422 `{ message, errors: { field: [...] } }`, 429 with `Retry-After`.

## Run it

Needs PHP 8.3+ (with mbstring, xml, curl, mysql, sqlite3, bcmath, intl, zip), Composer, and MySQL.

```bash
composer install
cp .env.example .env && php artisan key:generate
# set DB_* in .env, and BFF_SHARED_KEY (openssl rand -hex 32; the same value goes in frontend/.env.local as BUYNEST_BFF_KEY)
php artisan migrate --seed       # tables, roles, pages, home content, settings + local demo accounts + the demo catalog (downloaded once)
php artisan storage:link         # once: uploaded product images (storage/app/public) become /storage/...
php artisan serve --port=8000
```

The catalog comes from DummyJSON: `php artisan buynest:import-catalog` downloads it and adds or updates every product by SKU, keeping DummyJSON's ids. Run it again whenever you like: the shop's own fields (price, discount, stock, status) are kept, so staff edits and stock taken by orders survive. `--overwrite` resets those too. `db:seed` runs it in local development when there are no products yet.

Or start everything from the repository root with `./dev.sh`.

Local demo accounts (`php artisan db:seed`, local only):

| Who | Email | Password |
| --- | --- | --- |
| Shop admin (Owner) | admin@buynest.test | AdminPass2026 |
| Customer | customer@buynest.test | CustomerPass2026 |
| Second customer | shopper2@buynest.test | ShopperPass2026 |

Create a real admin (the first one this way; then from the admin's Admin users page): `php artisan buynest:create-admin you@example.com --name="Your Name"` (an Owner; `--role="Sales staff"` for another role).

## Email

In development (`APP_ENV=local`, `MAIL_MAILER=log`, `DEV_MAILBOX=true`) every email is kept in a **test inbox**: open http://127.0.0.1:8000/dev/mailbox to read the codes (including "Set your password"), order confirmations, order status, payment, shipment, refund, and return emails. Nothing reaches real people. That page doesn't exist outside local development.

For real email, change only the settings: `MAIL_MAILER=smtp` with `MAIL_HOST`, `MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD` (or a provider such as Mailgun, Postmark, or SES), and `DEV_MAILBOX=false`.

Brevo: `MAIL_MAILER=smtp`, `MAIL_HOST=smtp-relay.brevo.com`, `MAIL_PORT=587`, `MAIL_USERNAME` = your Brevo login, `MAIL_PASSWORD` = an SMTP key. Mailgun: `MAIL_HOST=smtp.mailgun.org`, `MAIL_PORT=587`, `MAIL_USERNAME=postmaster@your-domain`, `MAIL_PASSWORD` = its SMTP password. `MAIL_FROM_ADDRESS` must be on a domain verified with the provider (SPF, DKIM, and DMARC DNS records). Then check it:

```bash
php artisan buynest:mail-test you@example.com   # one test email; prints "Sent." or the error (without the login or password)
```

In production emails and newsletter batches go through the queue: `QUEUE_CONNECTION=database` and a worker (`php artisan queue:work --tries=3`).

## Card payments (Stripe, test mode)

Without Stripe keys, card orders wait for staff to invoice them (Sales → Orders → Invoice). To take test payments:

1. Create a free Stripe account and stay in **test mode**. Developers → API keys: copy the **secret key** (`sk_test_…`) into `.env` as `STRIPE_SECRET_KEY`.
2. Install the [Stripe CLI](https://docs.stripe.com/stripe-cli), run `stripe login`, then forward webhooks to the storefront's sign-in service (which passes them to this API unchanged):
   ```bash
   stripe listen --forward-to http://localhost:5173/api/payments/stripe/webhook
   ```
   It prints a signing secret (`whsec_…`): put it in `.env` as `STRIPE_WEBHOOK_SECRET`, then `php artisan config:clear` (if config is cached) and restart `php artisan serve`. Keep `stripe listen` running while you test.
3. Place an order with "Credit or debit card": you're sent to Stripe's page. Pay with the test card **4242 4242 4242 4242**, any future expiry date, any CVC, any postcode. Back on the confirmation page the order becomes paid within a few seconds (the webhook created the invoice). Other test cards: `4000 0000 0000 9995` (declined), `4000 0025 0000 3155` (asks for 3-D Secure).
4. Refund it in the admin (Credit memo): the money goes back to the test card; the memo shows the Stripe refund id.

`STRIPE_CURRENCY` (default `usd`) must match the store's prices; `STRIPE_CHECKOUT_MINUTES` (default 30, Stripe's minimum; at most 1440) is how long the payment page stays open; when it expires unpaid the order is cancelled and its stock released. Live mode: the same steps with `sk_live_…` and a webhook endpoint registered in the Stripe dashboard (`https://<store>/api/payments/stripe/webhook`, events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`). Tests never call Stripe (`Http::fake`).

## PayPal (sandbox)

Without PayPal keys, PayPal orders wait for staff to invoice them. To take sandbox payments: create a REST app in the [PayPal developer dashboard](https://developer.paypal.com/dashboard/applications/sandbox), copy its client id and secret into `.env` (`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_MODE=sandbox`), and add a webhook to `https://<store>/api/payments/paypal/webhook` with the events `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.CAPTURE.REVERSED`; put its id in `PAYPAL_WEBHOOK_ID`. Pay with a sandbox personal account. Live: `PAYPAL_MODE=live` with the live app's keys and webhook. `PAYPAL_API_URL` is only for tests against a stand-in. The scheduler must run (`buynest:payments:expire-paypal`). Tests never call PayPal (`Http::fake`).

## Tests

```bash
php artisan test     # 329 feature tests, against the buynest_test database (no network: products come from factories)
vendor/bin/pint      # code style
```

## Production checklist

- `APP_ENV=production`, `APP_DEBUG=false`, `DEV_MAILBOX=false`, a real mailer.
- Stripe: live keys only in production's environment (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` from the dashboard's webhook endpoint), never committed.
- A strong `BFF_SHARED_KEY`, shared only with the storefront's server functions.
- `BUYNEST_REQUIRE_BFF_KEY=true`: every `/api` request without that key gets 403, so only the storefront can use the API (the health check `/up` and photos under `/storage` stay open).
- Don't expose this API publicly if you don't need to: only the storefront's server calls it.
- Run the scheduler (`php artisan schedule:run` every minute) so unconfirmed sign-ups are cleaned up and catalog price rules start and end on time (`buynest:refresh-price-rules`; reads also check the time).
- Product photos: run `php artisan storage:link` once, keep `storage/app/public` on persistent disk (not a throwaway container filesystem) and include it in backups. The web server must serve `/storage/...` to the storefront's server functions, which pass photos to shoppers at `/media/...`.
- Uploads: allow request bodies up to 60 MB in the web server and PHP (`upload_max_filesize=5M`, `max_file_uploads=10`, `post_max_size=60M`).
- Phase 9 (part B): PHP's GD with JPEG, PNG and WebP (resized photos), the `mysqldump` client and a `BACKUP_DISK` both the scheduler and the API can reach (a bucket on multi-container hosts), and optionally `SENTRY_LARAVEL_DSN`.
- Phase 10 (part B): PayPal live keys and `PAYPAL_WEBHOOK_ID` only in production's environment; the scheduler running (unpaid PayPal orders expire after 3 hours).
- Phase 10 (part A): MySQL 5.7+/8 with InnoDB (FULLTEXT); after deploying run `php artisan migrate` (it builds the search index) and, after any import done with plain SQL, `php artisan buynest:search:reindex`. PHP's `dom` and `mbstring` (PDFs; DejaVu Sans ships with dompdf, nothing to install).

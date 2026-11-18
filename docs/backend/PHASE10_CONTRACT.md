# Phase 10 contract: better search, PDF documents, PayPal, shipping rates, gift cards, analytics

**Status: built (2026-11-18).** Choices made where this page left something open are in the implementation notes (parts A and B) at the end.

Keeps the conventions of phases 1 to 9 (`snake_case`, money as 2-decimal strings, `{ data }`, Laravel 422 errors, `can.admin:<key>` on every admin route, audit entries for admin changes, emails through the template system with defaults in code, the sign-in service in front of every browser call, the API locked to the store in production, the DummyJSON demo mode unchanged). No external account is needed to build or test anything here: external services are reached through small gateway classes and tested with stand-ins, like Stripe in phase 8.

## 1. Better search (typo-tolerant, ranked)

- A MySQL **FULLTEXT** index on products (`name`, `description`, brand name, tags, SKU) in natural-language mode for relevance; exact SKU and exact-name matches rank first, then name matches, then the rest by relevance, then rating.
- **Typo tolerance:** a `search_vocabulary` table (distinct lower-case words from active product names, brands, categories, tags, with counts), rebuilt when products change (debounced job) and by `php artisan buynest:search:reindex`. A query word with no match is corrected to the closest vocabulary word (Damerau–Levenshtein distance ≤ 1 for 4–7 letters, ≤ 2 for 8+, same first letter preferred, most frequent wins). The answer's `meta` adds `corrected_query` when a correction was used ("Showing results for **iphone**. Search instead for *ihpone*").
- Suggestions (`suggest=1`, phase 7) use prefix matches on names plus corrections, still not recorded as search terms.
- Works with the existing filters, sorting (explicit sorts override relevance), pagination, catalog price rules, and visibility rules. Tests run against MySQL (the test database already is MySQL).

## 2. PDF invoices and credit memos

- `GET /api/v1/orders/{number}/invoices/{invoice}.pdf` (owner token or the guest proof used by other guest routes) and the admin `GET /api/admin/v1/invoices/{number}.pdf`, `GET /api/admin/v1/credit-memos/{number}.pdf` (`orders.view`) return `application/pdf` with `Content-Disposition: attachment; filename="INV-100001.pdf"`.
- Generated on the server with **dompdf** (`barryvdh/laravel-dompdf` is acceptable), from a Blade view: store name, address and support email from settings, bill-to and ship-to, items with variant labels, discounts and applied rules, shipping, tax, totals, payment method and status, credit memo lines and refund reference. No remote resources (`isRemoteEnabled` off); fonts embedded (DejaVu Sans for wide character support). A4/Letter from a setting (`documents.paper_size`, default `a4`).
- The invoice email attaches the PDF (setting `documents.attach_pdf_to_emails`, default true).
- Storefront: "Download PDF" next to "Print" on the invoice page and on order pages; admin: "Download PDF" on invoice and credit memo pages and the order page.

## 3. PayPal payments

- Same design as Stripe (phase 8): PayPal **Orders API v2** with **redirect approval** (no PayPal script in the browser, so the CSP stays as it is). Settings (`.env`): `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_MODE` (`sandbox`|`live`), `PAYPAL_WEBHOOK_ID`, `PAYPAL_API_URL` (only for local tests). Enabled when id and secret are set; otherwise PayPal orders keep today's "wait for staff" behaviour. `GET /api/v1/store` adds `paypal_payments: "paypal"|"manual"`.
- `App\Services\Payments\PayPalGateway` (Laravel HTTP client; OAuth client-credentials token cached until expiry; `PayPal-Request-Id` idempotency header on every POST).
- Placing an order with `payment_method: "paypal"` creates a PayPal order (`intent: CAPTURE`, one purchase unit with the grand total, `custom_id` = order number, `return_url`/`cancel_url` to the confirmation page with `?payment=success|cancelled&provider=paypal`) and answers `payment: { provider: "paypal", url (the approve link), expires_at (3 hours) }`. On return with `?token=`, the storefront calls `POST /api/v1/orders/{number}/paypal/capture`; the API **captures** server-side, checks status `COMPLETED`, amount, and currency, then invoices through `OrderDocuments` exactly like Stripe.
- Webhooks `POST /api/v1/payments/paypal/webhook` (through the store with the shared key, like Stripe), verified with PayPal's **verify-webhook-signature** API using `PAYPAL_WEBHOOK_ID`; events `PAYMENT.CAPTURE.COMPLETED` (marks paid if the return trip was missed), `PAYMENT.CAPTURE.REFUNDED`/`REVERSED` (admin notification), `CHECKOUT.ORDER.APPROVED` (capture if not captured yet). Idempotent by event id (`payment_events` table, or reuse `stripe_events` generalised to provider + id).
- Unpaid PayPal orders expire after 3 hours like Stripe pages (scheduled check), cancelling and restocking once. Pay now works for PayPal too.
- Refunds on PayPal-paid orders call `POST /v2/payments/captures/{id}/refund` first, inside the transaction (refusal → 422, nothing saved).
- Admin shows provider PayPal, the capture id with a link to the PayPal dashboard (sandbox or live), and payment links like Stripe.

## 4. Shipping table rates

- `shipping_rates`: `id, method (standard|express|nextDay), country (ISO code or "*"), min_weight_grams, max_weight_grams null, min_subtotal, max_subtotal null, price, position`. When a method has any rows, its price comes from the first matching row (country exact before "*", then position); no matching row → the method isn't offered for that cart. Methods without rows keep the flat price from settings (phase 4). The free-shipping threshold and free-shipping cart rules still apply on top.
- Cart weight = sum of product (or variant) `weight` × quantity; products without a weight count as `shipping.default_weight_grams` (setting, default 500).
- Cart validation and checkout answer only available methods with their prices; the storefront's shipping step shows exactly those. Admin-created orders use the same rules.
- Admin (`settings.edit`): Settings → Shipping → **Table rates** editor (add/edit/delete/reorder rows per method, CSV import/export), and a "Check a cart" tool (country, weight, subtotal → prices per method).

## 5. Gift cards

- `gift_cards`: `id, code (16 chars, unambiguous alphabet, stored hashed + last 4 shown), initial_balance, balance, currency, status (active|disabled|expired), expires_at null, purchaser_order_item_id null, recipient_email null, recipient_name null, message null, created_by_admin_id null, timestamps`. `gift_card_transactions`: `id, gift_card_id, order_id null, credit_memo_id null, amount (negative = spent), note, created_at`.
- **Buying:** a product of `type: "gift_card"` (new product column `type`: `simple|gift_card`, default simple) with amount choices (`gift_card_amounts` json, e.g. [25, 50, 100]) or a custom amount within limits. The shopper enters recipient name, email, and a message. When the order is **paid** (invoiced), each card is created and emailed to the recipient (template `gift_card_received`) and the buyer gets a copy without the code. Gift-card lines don't need shipping (a cart with only gift cards skips shipping) and aren't taxed.
- **Redeeming:** at checkout `gift_card_code` (one card per order); the card's balance pays up to the grand total (after discounts, shipping, tax); if it covers everything, no other payment is needed (`payment_method: "gift_card"`). Balance is locked (`lockForUpdate`) and reduced on order placement; cancelling or refunding returns the used amount to the card. A refund of an order paid partly by card and partly by gift card returns money to the card first up to what it paid, then the rest by the other method (the admin refund dialog shows the split).
- `POST /api/v1/gift-cards/check { code }` → `{ balance, expires_at, status }` (rate-limited per visitor; the same 422 for unknown and disabled codes).
- Admin (`gift_cards.view`, `gift_cards.manage`): list (last 4, balance, status, recipient), create a card manually (e.g. compensation; emailed), adjust balance with a note, disable, history; reports include gift card sales and redemptions.
- Gift cards are not discounted by coupons or price rules, and can't buy other gift cards.

## 6. Visitor statistics with cookie consent

- Setting `analytics.ga4_measurement_id` (empty = off). When set, the storefront shows a **cookie consent banner** (Accept all / Reject / Settings with "Statistics" off by default), stores the choice in a first-party cookie for 6 months, and only then loads Google Analytics 4 (`gtag.js`) with **Consent Mode v2** defaults denied until accepted. Rejecting loads nothing. A "Cookie settings" link in the footer reopens the banner.
- Events: `page_view` on route changes, `view_item`, `add_to_cart`, `begin_checkout`, `purchase` (order number, value, currency, items without personal data). Never send emails, names, or addresses.
- CSP: when analytics is on, the built page's CSP allows `https://www.googletagmanager.com` for scripts and `https://*.google-analytics.com`, `https://*.analytics.google.com` for connections; when off, the CSP is unchanged. (The measurement id comes from the store settings at runtime, but the CSP allowance is decided at build time by `VITE_ANALYTICS=ga4`; document both.)
- The admin is never tracked.

## Permissions
New: `gift_cards.view`, `gift_cards.manage` (Marketing group; Marketing and Owner get them; Viewer gets `gift_cards.view`). Shipping rates and analytics use `settings.edit`.

## Tests
Backend feature tests for every rule (search ranking and typo correction incl. no false corrections on real words; PDF responses, headers, contents via text extraction or the HTML view; PayPal with a stand-in: create, capture, amount mismatch, webhook verification failure, duplicate event, expiry, refund and refusal; table rates matching, weight, unavailable methods, free shipping on top; gift cards: purchase → creation on payment only, emails, redemption with locking, full cover with no other payment, partial cover, cancel/refund returns balance, the same answer for unknown/disabled codes, no discounts on gift card lines). Storefront and admin unit tests; browser suite `e2e/extras.mjs` with stand-ins for PayPal and a fake GA endpoint (consent respected: nothing loads before Accept).

## Implementation notes — part A (search, PDF documents, analytics setting)

Backend choices for §1, §2 and the backend part of §6. Paths are under `/api/v1` (store) or `/api/admin/v1` (admin). Money is a `"0.00"` string, dates ISO 8601 UTC.

**Search (§1)**
- `GET /api/v1/products` keeps every phase 2–9 parameter and adds `correct` (boolean, default `1`): `correct=0` searches the words exactly as typed (the "Search instead for *ihpone*" link).
- With `search`, `meta` has `redirect_url` (phase 7, unchanged) and **`corrected_query: string | null`**: the normalized query that was actually searched (lower case, e.g. `"iphone case"`) when at least one word was corrected, else `null`. Without `search` neither key is present. Example: `?search=Ihpone` → `meta: { …pagination, redirect_url: null, corrected_query: "iphone" }`; the products are those for "iphone".
- Matching: a product matches when the whole phrase is found (as before: name, description, brand, category, plus now SKU, variant SKUs and tags) **or** the FULLTEXT index (natural-language mode) matches any word. The FULLTEXT index is `products_search_fulltext` on `products(name, description, search_text)`; `search_text` is a new column kept by the app: brand name, category name, tags, SKU, variant SKUs.
- Ranking (only when no `sort` is sent; an explicit `sort` keeps phase 2 ordering): 1. exact SKU (product or variant), 2. exact name, 3. the name starts with the phrase, 4. another word of the name starts with it, 5. the name contains the phrase or every query word, 6. the rest; inside each group by FULLTEXT relevance, then `rating_average` desc, then id. (InnoDB's FULLTEXT index only sees committed rows, so the feature tests, which run in a transaction, check groups and rating; relevance was checked on the dev database.)
- Typo correction: a query word is corrected only when (a) it has 4+ letters and no digits, (b) it is not a vocabulary word, (c) it is not part of any vocabulary word (so half-typed words are left alone), and (d) on its own it matches no product for sale. It becomes the closest vocabulary word with Damerau–Levenshtein (optimal string alignment) distance ≤ 1 (4–7 letters) or ≤ 2 (8+); ties: same first letter first, then smaller distance, then the most frequent word, then A–Z. A word that exists in the vocabulary is never corrected.
- The recorded search term (phase 7) is what the shopper typed; `last_results_count` is the total shown (after a correction). `suggest=1` gets the same matching, ranking and corrections, and is still not recorded.
- `search_vocabulary`: `word` (primary key, max 64), `count` (number of products for sale using it), `length` (characters, indexed: candidates are picked by length), `updated_at`. Words (2+ characters, lower case) from names, brand names, category names and tags of products for sale only (drafts never leak into corrections).
- Rebuilt by `php artisan buynest:search:reindex` (prints `Search index rebuilt: N products, M words.`; also refreshes every product's `search_text`), daily at 04:10 by the scheduler as a safety net, and automatically after catalog changes (products, variants, brands, categories): with `QUEUE_CONNECTION=sync` once at the end of the request/command, with a real queue as one `RebuildSearchVocabulary` job delayed 60 s (debounced through the cache).

**PDF documents (§2)**
- `GET /api/v1/orders/{number}/invoices/{invoice}.pdf` (`customer.optional`, `throttle:auth` like the other guest routes). Who may: the signed-in owner (Bearer token), or anyone sending the order's email as the **query parameter** `?email=` (case-insensitive). Otherwise 404 `{ message: "We couldn't find an order with that number and email." }`; proof OK but the invoice isn't on that order → 404 `{ message: "Invoice not found." }`. The existing JSON route `GET /orders/{number}/invoices/{invoice}` is unchanged (its `{invoice}` no longer accepts a dot).
- Admin: `GET /invoices/{number}.pdf` and `GET /credit-memos/{number}.pdf` (`can.admin:orders.view`); unknown → 404 `{ message: "Invoice not found." }` / `{ message: "Credit memo not found." }`.
- Answer: 200, `Content-Type: application/pdf`, `Content-Disposition: attachment; filename="INV-100001.pdf"` (`CM-…pdf` for credit memos), `Cache-Control: private, no-store`.
- Made with `barryvdh/laravel-dompdf` (dompdf 3) from `resources/views/documents/invoice.blade.php` / `credit-memo.blade.php`, DejaVu Sans, remote resources off (no images are loaded; the store name is text). The invoice shows the store name, address, support email and phone; invoice number and date, order number and date; payment method, provider and status; shipping method; bill-to and ship-to; items with variant label, SKU, price label, quantity, unit price, line discount and line total; coupon and applied cart rules; subtotal, discount, shipping, tax, total; **any extra money key part B adds to `OrderResource::totalsOf()`** (see hook below); paid and refunded; the credit memos (number, date, total, refund reference); the note only if the customer was told. The credit memo shows its lines, shipping refund, adjustment, total, refund reference, restocked, the order's payment method and the return number.
- **Hook for gift cards (part B)** — matches part B's names: when `totals.gift_card` (from `OrderResource::totalsOf()`) is above 0 the invoice shows "Paid by gift card −$x" and "Paid by <payment method> $`totals.amount_due`"; an item's `gift_card: { recipient_name, recipient_email, … }` shows "Gift card for <name> (<email>)" under the line; a credit memo whose `gift_card_refund` column is above 0 shows "Returned to gift card" and "Refunded to <payment method>" (total minus that). Any other numeric key added to `totalsOf()` later is shown too, labelled from its key. Nothing else is needed from part B.
- The invoice email (`InvoiceMail`, every place that sends it) attaches `INV-….pdf` when `documents.attach_pdf_to_emails` is on.

**Settings (§2, §6)** — `GET/PATCH /settings` gain two groups (`settings.edit`):
- `documents: { paper_size: "a4" | "letter" (default "a4"), attach_pdf_to_emails: boolean (default true) }`.
- `analytics: { ga4_measurement_id: string | null (default null) }` — must match `^G-[A-Z0-9]{4,12}$` (422 `analytics.ga4_measurement_id`: "Enter a GA4 measurement ID like G-ABC123XYZ, or leave it empty."); `""` or `null` saves `null` (off).
- `GET /api/v1/store` adds `ga4_measurement_id: string | null`.

## Implementation notes — part B (PayPal, shipping table rates, gift cards)

Backend choices for §3, §4, §5. Paths are under `/api/v1` (store) or `/api/admin/v1` (admin). Money is a `"0.00"` string, dates ISO 8601 UTC (`Z`). Everything not listed keeps its phase 1–9 shape.

### §3 PayPal

**Switches** — `config('buynest.paypal')`: `client_id` (`PAYPAL_CLIENT_ID`), `client_secret` (`PAYPAL_CLIENT_SECRET`), `mode` (`PAYPAL_MODE`, `sandbox` default | `live`), `webhook_id` (`PAYPAL_WEBHOOK_ID`), `api_url` (`PAYPAL_API_URL`; default `https://api-m.sandbox.paypal.com`, or `https://api-m.paypal.com` in live mode), currency = the store currency (`USD`), approval window 180 minutes, 15 s timeout, `BUYNEST_PAYPAL_WEBHOOKS_PER_MINUTE` (300). PayPal is **on** only when id and secret are set; off → PayPal orders wait for staff exactly as before and no PayPal call is ever made.
- `GET /store` adds `paypal_payments: "paypal" | "manual"`.
- Code: `App\Services\Payments\PayPalGateway` (the only class that calls PayPal: Laravel HTTP client, OAuth client-credentials token cached until 60 s before it expires, `PayPal-Request-Id` on every POST, a stale token is dropped and the call retried once), `App\Services\Payments\PayPalPayments` (orders, capture, webhook, expiry, refunds), `App\Services\Payments\OnlinePayments` (picks Stripe for `card`, PayPal for `paypal`; used by order answers, Pay now, admin payment links, staff cancel, refunds).
- Event idempotency is generalised: table `payment_events (provider, id, type, processed_at, created_at)`, primary key `(provider, id)`; Stripe's rows were moved there (`provider "stripe"`) and `stripe_events` dropped. Results and behaviour of the Stripe webhook are unchanged.

**`payment` on every order answer** — same object as phase 8, `provider: "paypal"` for PayPal orders:
```
payment: {
  provider: "stripe" | "paypal" | "gift_card" | null,
  paid_at, url (the open PayPal approval link), expires_at, can_pay,  // can_pay: PayPal on, method "paypal", unpaid, pending_payment
  error?: string,
  // admin only:
  reference: string | null,     // PayPal: the capture id
  dashboard_url: string | null  // https://www.sandbox.paypal.com/activity/payment/{capture id} (www.paypal.com in live mode)
}
```

**Placing a PayPal order** — `POST /orders` with `payment_method: "paypal"` (PayPal on) → 201; `data.payment` = `{ provider: "paypal", url: <approve link>, expires_at: <+3 h>, can_pay: true, paid_at: null }`: send the browser to `url`. PayPal unreachable → still 201, `url: null` + `error`, show **Pay now**. The PayPal order: `intent: CAPTURE`, one purchase unit `{ reference_id, custom_id: <order number>, description: "<store> order BN-…", amount: { currency_code: "USD", value: <amount due> } }`, `payment_source.paypal.experience_context` with `return_url` = `{STOREFRONT_URL}/order-confirmation/{number}?payment=success&provider=paypal`, `cancel_url` = `…?payment=cancelled&provider=paypal`, `user_action: PAY_NOW`, `shipping_preference: NO_SHIPPING`. Request id `order-{id}-paypal-{n}`. The amount is the **amount due** (grand total less a gift card, see §5).
- PayPal adds `&token=<PayPal order id>&PayerID=…` to the return URL.

**Capture** — `POST /orders/{number}/paypal/capture { token, email? }` (`customer.optional`, rate limit like the lookup; who: the owner's token or the order's email, else 404 like the lookup).
- 200 `{ data: OrderResource, result: "paid" | "already_paid" }` — the order is paid (`payment.provider "paypal"`, `payment_status "paid"`, invoice "Paid through PayPal.", invoice email).
- 422 `{ message, errors: { payment: [msg] } }`: "This PayPal payment doesn't belong to this order." (token ≠ the order's current PayPal order), "PayPal is still processing this payment. We'll email you as soon as it's confirmed." (capture `PENDING`; the `PAYMENT.CAPTURE.COMPLETED` webhook finishes it), "PayPal declined the payment: … You can try again with Pay now.", amount/currency mismatch ("We couldn't confirm this payment. Our team has been told and will contact you."; order left unpaid + critical `payment_problem` notification), PayPal unreachable ("PayPal could not be reached. Please try again in a moment." — retrying is safe: same request id `capture-{paypal order id}`), and the Pay now problems below (cancelled, not PayPal, PayPal off).
- PayPal's `ORDER_ALREADY_CAPTURED` is handled by reading the order (`GET /v2/checkout/orders/{id}`) and using its capture.

**Pay now / admin payment link** — `POST /orders/{number}/pay` and `POST /api/admin/v1/orders/{number}/payment-link` work for PayPal orders too (a new approval link when the open one has less than 2 minutes left). 422 messages for PayPal orders: "Online PayPal payments aren't available right now. We'll contact you about the payment.", "This order isn't paid with PayPal.", plus the phase 8 ones (already paid, cancelled, not waiting). Admin-created PayPal orders get `data.payment.url` (open 3 hours, PayPal's limit).

**Webhook** — `POST /payments/paypal/webhook` (no auth; `throttle:paypal-webhooks`; through the sign-in service like Stripe's). Forward the **raw body** and the headers `PAYPAL-AUTH-ALGO`, `PAYPAL-CERT-URL`, `PAYPAL-TRANSMISSION-ID`, `PAYPAL-TRANSMISSION-SIG`, `PAYPAL-TRANSMISSION-TIME`.
- Verified by `POST /v1/notifications/verify-webhook-signature` with `PAYPAL_WEBHOOK_ID`; anything but `verification_status: "SUCCESS"` (or a missing header / webhook id) → **400** `{ message: "Invalid PayPal signature." }`; PayPal unreachable → **503** `{ message: "PayPal could not be reached to verify the event." }` (PayPal retries).
- Valid → **200** `{ received: true, result }`, `result`: `paid`, `already_paid`, `duplicate`, `amount_mismatch`, `cancelled_order`, `unknown_order`, `refund_noted`, `ignored`, `capture_failed`, `pending` (capture still PENDING at PayPal), `declined`.
- `PAYMENT.CAPTURE.COMPLETED` (capture; order by `custom_id`, else by the related PayPal order id): marks paid if the return trip was missed (same checks as capture). `CHECKOUT.ORDER.APPROVED` (order): captures it if it's still the order's current PayPal order and unpaid. `PAYMENT.CAPTURE.REFUNDED` / `PAYMENT.CAPTURE.REVERSED`: refunds we made ourselves (refund id = a credit memo's `refund_reference`) → `ignored`; others → critical `payment_problem` notification "PayPal payment refunded/reversed outside BuyNest" → `refund_noted`. Each event id is handled once (`payment_events`, provider `paypal`).

**Expiry** — `php artisan buynest:payments:expire-paypal` (scheduled every 5 minutes): unpaid `pending_payment` PayPal orders whose approval window (3 h) has passed. Each order is locked and re-checked; PayPal is asked first (`GET` order): `COMPLETED` → marked paid; `APPROVED` → captured; otherwise cancelled once through the normal cancel (stock, coupon uses, gift card balance back), history "Payment not completed: the PayPal payment window expired. Order cancelled; items returned to stock.", "Payment not completed" email. PayPal unreachable → skipped until the next run.

**Refunds** — a credit memo on an order paid through PayPal (`payment_provider "paypal"` with a capture id) calls `POST /v2/payments/captures/{id}/refund { amount: { value, currency_code } }` (request id `memo-order-{id}-{n}-{cents}`) **before** saving, inside the transaction; refusal / unreachable / status `FAILED`/`CANCELLED` → **422** `{ errors: { refund: ["PayPal refused the refund: …"] } }`, nothing saved. `refund_reference` = the PayPal refund id. Only the part not returned to a gift card is sent to PayPal (§5).

### §4 Shipping table rates

**Rows** — `{ id, method: "standard"|"express"|"nextDay", country: "*" | "<country>", min_weight_grams: int, max_weight_grams: int|null, min_subtotal: "0.00", max_subtotal: "0.00"|null, price: "0.00", position: int }`. The store keeps countries as names (Settings → Checkout), so `country` is `"*"` or a country **name**; an ISO 3166 alpha-2 code (e.g. `US`, `DE`) is accepted on input and stored as the name. Ranges are inclusive at the minimum and exclusive at the maximum (`min ≤ x < max`; null max = no limit).
- A method with any rows takes its price from the first matching row: exact country before `"*"`, then `position`, then id. No matching row → the method isn't offered. A method with no rows keeps its flat price. The free-shipping threshold (standard only) and free-shipping cart rules then make the price 0 as before.
- **Weight** = Σ (variant weight, else product weight, else the setting `shipping.default_weight_grams` [default 500]) × quantity, over lines that need shipping (gift cards don't). Product `weight` is in grams (admin product form: `weight`), variants have an optional `weight` too (variant PATCH).
- **Subtotal** for matching = the shippable lines' subtotal after catalog and group prices, before cart price rules.
- **Country**: the cart's `country` (cart/validate) / the shipping address country (checkout, admin). Without a country only `"*"` rows match.

**cart/validate** (and admin `POST /orders/quote`) — `shipping_options` lists only the methods available for this cart: `[{ id, label, eta, price, source: "table"|"flat" }]`. New keys: `shipping_method` (the id the totals use, `null` when none is possible or needed), `shipping_required: bool` (false for a cart of only gift cards: no options, shipping `0.00`), `shipping_error: string|null` ("We can't ship this order to Germany with the available methods." / "…to this address…" when nothing matches), `weight_grams: int`. A chosen method that isn't available falls back to the first available one in cart/validate.
- **Checkout** (`POST /orders`, admin `POST /orders`): `shipping_method` is required unless every item is a gift card; a method not available for the cart → 422 `{ errors: { shipping_method: ["This shipping method isn't available for your order. Please choose another one."] } }`; nothing available → 422 on `shipping_method` with `shipping_error`. Gift-card-only orders store `shipping_method "none"`, label "No shipping needed".

**Admin** (read `settings.view`, change `settings.edit`; every change audited `shipping_rate.*`):
- `GET /shipping-rates?method=` → `{ data: [Row…], meta: { default_weight_grams, methods: [{ id, label, flat_price, rows }] } }` (ordered method, position, id).
- `POST /shipping-rates` `{ method, country, min_weight_grams?, max_weight_grams?, min_subtotal?, max_subtotal?, price, position? }` → 201 `{ data: Row }` (position defaults to the end of its method).
- `PATCH /shipping-rates/{id}` (same fields, all optional) → `{ data: Row }`; `DELETE /shipping-rates/{id}` → 204.
- `POST /shipping-rates/reorder { method, ids: [..] }` (every row of that method, new order) → `{ data: [Row…] }`.
- `GET /shipping-rates/export.csv` → `text/csv`, header `method,country,min_weight_grams,max_weight_grams,min_subtotal,max_subtotal,price,position`.
- `POST /shipping-rates/import` multipart `file` (CSV, same header), `mode: "replace"|"append"` (default `replace`: replaces the rows of the methods present in the file) → `{ data: { imported: n, replaced: n } }`; any bad row → 422 with `errors: { "rows.3.price": [...] }` and nothing saved.
- `POST /shipping-rates/check { country?, weight_grams, subtotal }` → `{ data: [{ method, label, available: bool, price: "0.00"|null, source: "table"|"flat", rate_id: int|null }] }` (enabled methods; free-shipping rules not applied: it shows the rate).
- Setting `shipping.default_weight_grams` (integer 0–100000) in `GET/PATCH /settings` → `shipping`.

### §5 Gift cards

**Products** — new product fields (store and admin answers): `type: "simple" | "gift_card"`, `gift_card: null | { amounts: ["25.00", "50.00", "100.00"], custom: null | { min: "10.00", max: "500.00" } }`. Admin create/update accepts `type`, `gift_card_amounts: [25, 50, 100]` (1–10 amounts, 1.00–10000.00), `gift_card_min_amount` + `gift_card_max_amount` (both or neither: custom amounts allowed), `weight` (grams, nullable). A gift card product needs at least one amount or a custom range and can't have options; its stock is not tracked (never "out of stock", never decremented). Gift card prices ignore the product's price, discount, catalog rules, and group discount: the line costs the chosen amount.

**Cart lines** (`cart/validate`, `POST /orders`, admin quote/create) — an item of a gift card product carries
```
{ product_id, quantity, gift_card: { amount: "50.00", recipient_name, recipient_email, message? } }
```
(`message` ≤ 500 chars). Each such item is its own line (never merged). Answer lines add `type`, `requires_shipping: bool`, and `gift_card: { amount, recipient_name, recipient_email, message } | null`. Problems (line not charged): `gift_card_details_required` ("Choose an amount and enter the recipient for {name}."), `gift_card_amount_invalid` ("Choose one of the amounts for {name}." / "…between $10.00 and $500.00…"). Gift card lines get no cart rule discount (`discount: "0.00"`), no tax, don't count toward coupon minimums or the free-shipping threshold, and need no shipping.

**Redeeming** — `cart/validate`, `POST /orders`, and admin quote/create accept `gift_card_code` (spaces and dashes ignored, case-insensitive; one card per order). cart/validate answer adds
```
gift_card: null | { last4, balance: "80.00", applied: "24.99", balance_after: "55.01", expires_at },
gift_card_error: string | null,      // "This gift card code isn't valid." (unknown, disabled, expired: same text), "This gift card has no balance left.", "Gift cards can't be used to buy other gift cards."
totals: { …, gift_card: "24.99", amount_due: "0.00" }   // amount_due = total − gift_card
```
The card pays up to the grand total less any gift card lines. At checkout an error → 422 on `gift_card_code`. When the card covers everything, `payment_method` may be `"gift_card"` (any method sent is replaced by it): the order is placed **paid** at once (invoice "Paid with gift card ••••ABCD.", status `processing`). `payment_method: "gift_card"` with a balance that doesn't cover the total → 422 on `payment_method` ("Your gift card doesn't cover the whole total. Choose how to pay the rest."). The balance is locked (`lockForUpdate`) and taken when the order is placed (transaction row). Stripe/PayPal charge only `amount_due`. Cancelling an order returns the used amount to the card.

**Orders** — `totals` adds `gift_card: "0.00"` (paid with a gift card) and `amount_due` (total − gift card); `gift_card: { last4, amount } | null` at the top of the order (also on invoices: `InvoiceResource` has the same `totals` and `gift_card`); items add `gift_card: { amount, recipient_name, recipient_email, message } | null`. Admin orders add `gift_cards_issued: [{ id, last4, amount, recipient_email, status }]` (cards bought with the order). `payment_method: "gift_card"` is labelled "Gift card".

**Issuing** — when a gift card purchase is **invoiced** (staff invoice, PATCH paid, bulk, Stripe/PayPal webhook or capture), one card per unit is created (16 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, shown `XXXX-XXXX-XXXX-XXXX`; stored as SHA-256 + last 4), emailed to the recipient (`gift_card_received`: code, amount, sender name, message), and the buyer gets `gift_card_purchased` (recipient, amount, last 4, no code). Once per order item.

**Refunds** — `GET /orders/{number}/refundable` adds `gift_card_refundable` (what can still go back to the card). A credit memo returns money to the redeemed card **first**, up to what the card paid and wasn't returned yet; only the rest goes to Stripe/PayPal (or by hand). Credit memo answers add `gift_card_refund` and `other_refund` (= total − gift_card_refund). Refunding units of a gift card **purchase** line disables that many unused cards from it (cards with spending → 422 `items.N.quantity`: "1 gift card from this line was already used, so it can't be refunded.").

**Check** — `POST /gift-cards/check { code }` (`throttle:gift-card-check`, 10 per minute per visitor) → 200 `{ data: { last4, balance, currency: "USD", expires_at, status: "active" } }`; unknown, disabled, and expired codes all → 422 `{ message: "This gift card code isn't valid.", errors: { code: ["This gift card code isn't valid."] } }`.

**Admin** (`gift_cards.view` / `gift_cards.manage`; audited `gift_card.*`):
- Card: `{ id, last4, initial_balance, balance, currency, status: "active"|"disabled"|"expired", expires_at, recipient_name, recipient_email, message, purchase_order_number, created_by_admin: { id, name } | null, created_at, updated_at }` (`status` is `expired` once `expires_at` has passed).
- `GET /gift-cards?search=&status=&page=&per_page=` (search: last 4, recipient email/name, purchase order number) → paginated `{ data, links, meta }`.
- `GET /gift-cards/{id}` → card + `transactions: [{ id, amount (negative = spent), balance_after, note, order_number, credit_memo_number, admin_name, created_at }]` (newest first).
- `POST /gift-cards { amount, recipient_email?, recipient_name?, message?, expires_at?, notify_recipient? (default true, needs an email) }` [manage] → 201 `{ data: card + code }` — the full `code` is in this answer only.
- `POST /gift-cards/{id}/adjust { amount (signed, e.g. "-5.00"), note }` [manage] → `{ data }`; a balance below 0 → 422 on `amount`.
- `PATCH /gift-cards/{id} { status?: "active"|"disabled", expires_at?: ISO|null }` [manage] → `{ data }`.
- `GET /reports/gift-cards?from=&to=` (dates, default the last 30 days) [reports.view] → `{ data: { from: "YYYY-MM-DD", to, sold: { count, amount }, issued_by_staff: { count, amount }, redeemed: "0.00", returned: "0.00", outstanding_balance: "0.00", active_cards: n } }` (sold = gift card lines of orders invoiced within the dates; redeemed = spent at checkout; returned = given back by cancels and refunds; outstanding and active over all active, unexpired cards).

**Other rules** — gift card products always show `availability: "in_stock"` (their `stock_quantity` is ignored); gift card lines are never returnable through returns (RMA: `returnable: 0`); a signed-in customer's saved cart (phase 7) keeps only non-gift-card lines (the recipient details stay in the browser's cart); cancelling an order never restocks gift card lines.

**Emails** — templates `gift_card_received` (variables `recipient_name`, `sender_name`, `amount`, `code`, `message` [block], `expires` [text], `shop_url`, `button`; requires `code`) and `gift_card_purchased` (`customer_first_name`, `order_number`, `recipient_name`, `recipient_email`, `amount`, `last4`; requires `recipient_email`).

**Permissions** — `gift_cards.view`, `gift_cards.manage` (Marketing group); migration `2026_11_18_000240_grant_gift_card_permissions` gives Marketing both and Viewer `gift_cards.view` (Owner has every key).

**Database** — `2026_11_18_000200_create_payment_events` (moves `stripe_events`), `…000210_create_shipping_rates` (+ `product_variants.weight`), `…000220_create_gift_cards` (`gift_cards`, `gift_card_transactions`, `products.type/gift_card_amounts/gift_card_min_amount/gift_card_max_amount`, `order_items.gift_card`, `orders.gift_card_id/gift_card_amount`, `credit_memos.gift_card_refund`), `…000240_grant_gift_card_permissions`.

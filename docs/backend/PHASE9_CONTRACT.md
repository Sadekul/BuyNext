# Phase 9 contract: launch readiness and customer self-service

**Status: built (2026-11-17).** Choices made where this page left something open are in the implementation notes (parts A and B) at the end.

Keeps the conventions of phases 1 to 8 (`snake_case`, money as 2-decimal strings, `{ data }`, Laravel 422 errors, `can.admin:<key>` on every admin route, audit entries for admin changes, emails through the template system with defaults in code, the sign-in service in front of every browser call, the DummyJSON demo mode unchanged).

## 1. Two-step sign-in for admins (TOTP)

- Standard authenticator-app codes (RFC 6238: 6 digits, 30-second steps, SHA-1, ±1 step tolerance), implemented in a small service without a package. Secrets are stored **encrypted** (Laravel's encrypter) in `admins.two_factor_secret`; `two_factor_confirmed_at`; `two_factor_recovery_codes` (10 one-time codes, stored as hashes). A code that was just used can't be used again within its window (replay guard).
- Enrolment (signed-in admin, no extra permission): `POST /api/admin/v1/me/two-factor` → `{ secret, otpauth_url, qr_svg }` (not yet active); `POST /me/two-factor/confirm { code }` → active + `{ recovery_codes: [10 plain codes, shown once] }`; `POST /me/two-factor/recovery-codes { password }` → new set; `DELETE /me/two-factor { password, code }` → off (refused while the store requires it). QR as SVG made on the server (a small, well-known QR package is acceptable; say which and why), never sent to a third-party service.
- Sign-in: password correct + two-step on → `200 { data: { two_factor_required: true, challenge, expires_at } }` (no tokens). `challenge` is a random token stored hashed with the admin id, valid 5 minutes, single use. `POST /api/admin/v1/auth/two-factor { challenge, code | recovery_code, remember }` → the usual token pair. 5 wrong codes → the challenge is burned; rate-limited like sign-in; audited (success and failure).
- Setting `security.require_admin_two_factor` (default false; Owner-only to change, via `settings.edit` + Owner check). When on, an admin without two-step gets `{ two_factor_setup_required: true }` after the password and a limited token that can only reach the enrolment routes and `me`.
- Owner can reset another admin's two-step (`POST /admins/{id}/two-factor/reset`, `admins.manage` + Owner), which signs them out everywhere; audited.
- Admin UI: Account → **Two-step sign-in** page (QR, key for manual entry, confirm, recovery codes with copy/download as .txt, regenerate, turn off); the sign-in page's second step ("Enter the 6-digit code from your authenticator app" / "Use a recovery code"); a forced-setup screen; Settings → Security toggle; a reset action on Admin users.

## 2. Resized product photos

- On upload (phase 5), when GD or Imagick is available, make **thumb** (max 320 px) and **medium** (max 960 px) copies next to the original (`…-320.webp`/`…-960.webp` when WebP encoding is available, otherwise the original format), never upscaling; strip metadata by re-encoding. `product_images.variants` json `{ "320": url, "960": url }`. Without GD/Imagick (this development computer) uploads keep working with the original only.
- `php artisan buynest:images:resize [--force]` makes copies for existing uploads (external DummyJSON URLs untouched).
- API: image items add `variants`; product cards and galleries use `srcset`/`sizes` with the original as fallback; `/media` serves the new file names (update its allow-list to `^products/\d+/[a-f0-9]{32}(-(320|960))?\.(jpg|png|webp)$`).
- `backend/Dockerfile` adds GD with JPEG, PNG, and WebP support.
- Tests that need GD are skipped (with a clear message) when it isn't installed; the logic that decides sizes and names is tested without it.

## 3. Error alerts and backups

- **Errors:** the backend reports exceptions to Sentry when `SENTRY_LARAVEL_DSN` is set (the official `sentry/sentry-laravel` package is acceptable; nothing is sent when the DSN is empty, and personal data is not sent: no request bodies, cookies, or auth headers; user = id and kind only). Browser errors (store and admin: React error boundaries, `window.onerror`, unhandled rejections) are posted to the sign-in service at `POST /api/client-errors` (`{ message, stack (max 8 KB), url (path only), app: "store"|"admin", release }`; rate-limited per visitor, deduplicated), which forwards them to `POST /api/v1/client-errors` (needs the shared key), where Laravel reports them to Sentry tagged `client`. No third-party script in the browser; the CSP stays as it is.
- **Backups:** `php artisan buynest:backup` runs `mysqldump --single-transaction` (credentials passed through a temporary defaults file, never on the command line), gzips it to the `backups` disk (`BACKUP_DISK`: `local` = `storage/app/backups` on a volume, or `s3` for any S3-compatible bucket; the S3 adapter package is acceptable), names it `buynest-YYYYMMDD-HHMMSS.sql.gz`, keeps `BACKUP_KEEP_DAYS` (default 14), and records the result. Scheduled daily at 03:00 (store time) and on demand; `--list` prints backups. A failed backup creates a critical admin notification (`backup_failed`, Owner only) and is reported to Sentry.
- Admin: System → **Backups** (Owner only, new permission `backups.view`): last backups with size and time, "Back up now", and download (signed URL valid 5 minutes, audited). Restore is documented, not a button.
- `Dockerfile` adds the MySQL client; `docs/DEPLOY_RAILWAY.md` gains the Sentry DSN, backup volume or bucket variables, Railway's own volume backups as a second layer, and a tested **restore** procedure.

## 4. Customers change their own email

- `POST /api/v1/me/email { email, password }` → sends a 6-digit code (existing one-time code system, purpose `email_change`) to the **new** address; the account keeps the old email until confirmed. `POST /api/v1/me/email/confirm { code }` → switches the email, emails the **old** address ("Your BuyNest email was changed" with how to get help), signs out other sessions, audits. The new email must not belong to another customer (same generic 422 as sign-up, so it doesn't reveal accounts). Rate limits as for sign-up codes.
- Storefront: Account → Profile → "Change email" (two steps).

## 5. Customers cancel their own order

- `POST /api/v1/orders/{number}/cancel { reason? }` (owner token, or a guest with the order's email like the other guest routes): allowed while the order is `pending`, `pending_payment`, or `processing`, **not paid, nothing invoiced, nothing shipped**; uses the existing cancel logic (restock, coupons released, open Stripe page closed, email "Your order was cancelled"). Paid or shipped orders: 422 with "Contact us to cancel" text (refunds stay with staff).
- Order answers add `can_cancel`. Storefront: "Cancel order" with a confirmation dialog on the account order page, guest tracking, and the confirmation page.

## 6. Download my data, delete my account

- `GET /api/v1/me/export` → a JSON file (`Content-Disposition: attachment; buynest-my-data-YYYY-MM-DD.json`): profile, group, addresses, orders (with items, invoices, refunds, returns), reviews, newsletter status, saved cart, stock alerts. Never other people's data, staff notes, or internal ids beyond order numbers. Rate-limited (3 per hour).
- `POST /api/v1/me/delete { password, confirm: "DELETE" }` → the same rules as staff deletion (phase 6: refused while an order is open), then deletes the account (orders kept without the customer link, reviews kept with the author name), unsubscribes the newsletter, removes stock alerts and saved cart, signs out everywhere, and emails a confirmation. Audited without personal data.
- Storefront: Account → **Privacy** page with both actions (deletion behind a typed confirmation).

## 7. "Email me when it's back in stock"

- `stock_alerts`: `id, product_id, variant_id null, email, customer_id null, token_hash, created_at, notified_at null`. Unique per (product, variant, email) while not notified.
- `POST /api/v1/products/{id}/stock-alerts { email?, variant_id? }`: signed-in customers use their account email; guests give one; always `202` with the same message (no way to learn whether an email was already listed); only for products or variants that are out of stock (else 422); rate-limited.
- When stock goes from 0 (or below the minimum order quantity) to available — through the admin, imports, bulk actions, refunds with restock, or cancellations — waiting alerts for that product/variant get the `back_in_stock` email (queued, batches of 100), with a one-click "stop these alerts" link (signed token), and are marked notified. A product that's active and visible only.
- Admin: Reports → **Stock alerts** (`reports.view`): products with waiting alerts and counts; the product page shows its waiting count.
- Storefront: sold-out product pages and sold-out variants show "Email me when it's back"; a signed-in customer's Account → Stock alerts lists theirs with remove.

## Permissions
New: `backups.view` (System; Owner only by default). Two-step settings and resets need Owner. Everything else uses existing keys.

## Tests
Backend feature tests for every rule above (TOTP verification against RFC 6238 test vectors, replay guard, challenge expiry and burn after 5 tries, recovery codes single-use, forced enrolment, Owner-only settings and reset; resize names and no-upscale (GD tests skipped if missing); client-error limits and scrubbing; backup command with a fake process and disk, retention, failure notification, signed download; email change flow including the old-address notice and generic duplicate answer; customer cancel rules and side effects; export contents and exclusions; delete rules; stock alerts: same answer, only when sold out, notifications on every restock path, once per alert, unsubscribe). Storefront and admin unit tests; a new browser suite `e2e/launch.mjs`.

## Implementation notes — part A (two-step sign-in, email change, customer cancel, my data)

Backend choices for §1, §4, §5, §6. Paths are under `/api/admin/v1` (admin) or `/api/v1` (store). Dates ISO 8601 UTC (`Z`), money `"0.00"` strings, 422 answers are Laravel's `{ message, errors: { field: [..] } }`.

**Token pairs (every sign-in, refresh, and the new two-step answers)**
- `tokens` gains `scope`: `"full"` (normal) or `"two_factor_setup"` (the limited pair below). Otherwise unchanged: `{ access_token, access_expires_in, refresh_token, refresh_expires_in, remember, scope }`.

**Two-step sign-in (admins, §1)**
- TOTP: RFC 6238, SHA-1, 6 digits, 30-second steps, ±1 step. Secret: 20 random bytes, Base32 (32 chars), stored encrypted (`admins.two_factor_secret`, Laravel's encrypter). Replay guard: a code's time step must be newer than the last accepted one (`two_factor_last_step`), so the same code (or an older one) never works twice. Recovery codes: 10, format `xxxxx-xxxxx` (lower-case letters and digits), stored as keyed hashes (HMAC-SHA256 with `APP_KEY`), each works once; typed case-insensitively, the dash optional.
- QR: an SVG made on the server with `bacon/bacon-qr-code` (the QR library Laravel Fortify uses; no network calls). `otpauth_url` = `otpauth://totp/BuyNest:{email}?secret=…&issuer=BuyNest&algorithm=SHA1&digits=6&period=30` (issuer = store name).
- Admin resource (lists, detail, `GET /me`, sign-in answers) gains `two_factor_enabled: bool`. `GET /me` and the `admin` of sign-in answers also gain `two_factor: { enabled, confirmed_at (ISO|null), recovery_codes_left (int), required (the store setting) }`.

Sign-in:
- `POST /auth/login` (unchanged body):
  - two-step off and not required → as before: `{ data: { admin, tokens } }`.
  - two-step on → 200 `{ data: { two_factor_required: true, challenge: "<64 chars>", expires_at } }` (no tokens; `last_login_at` not updated yet). The challenge lasts 5 minutes and works once.
  - the store requires two-step and this admin hasn't set it up → 200 `{ data: { two_factor_setup_required: true, admin, tokens } }` with `tokens.scope: "two_factor_setup"`. That pair only reaches `GET /me`, `POST /auth/logout`, `POST /me/two-factor`, `POST /me/two-factor/confirm` (and `POST /auth/refresh`, which gives another limited pair until setup is done). Anything else → **403** `{ message: "Set up two-step sign-in to continue.", code: "two_factor_setup_required" }`.
- `POST /auth/two-factor { challenge, code?, recovery_code?, remember? }` (no token; limited per visitor 30/min and per challenge 10/min) → 200 `{ data: { admin, tokens } }`, exactly like a normal sign-in. Send `code` (6 digits) **or** `recovery_code`.
  - unknown / expired / used / burned challenge → 422 `challenge`: "This sign-in has expired. Please sign in again."
  - wrong code → 422 `code`: "That code isn't right. Check your authenticator app and try again." (or `recovery_code`: "That recovery code isn't right or was already used."); the 5th wrong try burns the challenge → 422 `challenge`: "Too many wrong codes. Please sign in again."
  - neither sent → 422 `code`: "Enter the 6-digit code from your authenticator app."
  - account deactivated meanwhile → 403 `{ code: "account_disabled" }`.
  - Audit: `admin.signed_in` ("… signed in with two-step sign-in" / "… with a recovery code"), `admin.two_factor_failed` (each wrong code, no admin attached, subject the admin).
- Store setting on, an admin **already signed in** without two-step: their full token gets the same 403 `two_factor_setup_required` on every route except `GET /me`, logout and the two enrolment routes — show the forced-setup screen.

Enrolment (any signed-in admin, no permission key):
- `POST /me/two-factor` (full or limited token) → 200 `{ data: { secret: "JBSWY3DP…", otpauth_url, qr_svg: "<svg …>" } }`. Not active yet; calling it again replaces the secret. Already on → 422 `two_factor`: "Two-step sign-in is already on."
- `POST /me/two-factor/confirm { code }` (full or limited token) → 200 `{ data: { recovery_codes: ["abcde-12345", … 10], admin, tokens? } }`. Two-step is on from now. `tokens` (a new **full** pair) is present **only** when the call was made with the limited setup token; that limited pair is signed out, so store the new pair. Errors: 422 `code` "That code isn't right. …"; 422 `two_factor` "Start the setup first." (no pending secret) / "Two-step sign-in is already on.". Audit `admin.two_factor_enabled`.
- `POST /me/two-factor/recovery-codes { password }` (full token) → 200 `{ data: { recovery_codes: [10 new] } }` (the old ones stop working). 422 `password` "The password is incorrect."; 422 `two_factor` "Two-step sign-in is off." Audit `admin.two_factor_recovery_codes_regenerated`.
- `DELETE /me/two-factor { password, code }` (full token; `code` = a current 6-digit code or a recovery code) → 200 `{ message: "Two-step sign-in is off.", data: admin }`. 422 `two_factor` "The store requires two-step sign-in for every admin, so you can't turn it off." / "Two-step sign-in is off."; 422 `password`; 422 `code`. Audit `admin.two_factor_disabled`.

Owner controls:
- Settings: new group `security: { require_admin_two_factor: bool }` (default `false`) in `GET/PATCH /settings`. Changing it needs `settings.edit` **and** the Owner role: otherwise 403 `{ message: "Only an Owner can change security settings.", code: "owner_only" }`. Turning it on while the Owner's own account has no two-step → 422 `security.require_admin_two_factor`: "Turn on two-step sign-in for your own account first."
- `POST /admins/{id}/two-factor/reset` (`admins.manage` + Owner; else 403 `owner_only`) → 200 `{ message: "Two-step sign-in was reset. … has been signed out everywhere.", data: admin }`. Turns it off, deletes secret and recovery codes, signs that admin out everywhere. 422 `two_factor` "This admin doesn't use two-step sign-in." / "Use Account → Two-step sign-in to change your own." Unknown id → 404 `Admin not found.` Audit `admin.two_factor_reset`.

**Change email (customers, §4)** — customer token, limited per account (10/min) and per visitor.
- `POST /me/email { email, password }` → 200 `{ message: "We emailed a 6-digit code to new@example.com. Your email stays the same until you enter it.", data: { email: "new@example.com", expires_in: 600, resend_in: 60 } }`. Within a minute of the last code to that address no new code is sent (same 200, `resend_in` > 0). Errors 422: `password` "Your password is incorrect."; `email` "This is already your email address."; `email` "An account with this email already exists. Sign in, or reset your password." (sign-up's answer).
- `POST /me/email/confirm { code }` → 200 `{ message: "Your email is now new@example.com.", data: customer }`. Errors 422 `code`: "That code is incorrect or has expired." / "Too many wrong attempts. Ask for a new code."; 422 `email`: "Ask for a code first." (nothing pending) or the duplicate message above. After the switch: the email is verified, the newsletter subscription (if any) moves to the new address, every **other** session is signed out (the current one stays), the old address gets "Your BuyNest email was changed" (template `email_changed`), audit `customer.email_changed`.
- `GET /me` (and `data` above) adds `pending_email: string | null`.
- Email templates: `email_change_code` (variables `customer_first_name`, `code`, `expires_minutes`, `new_email`) and `email_changed` (`customer_first_name`, `old_email`, `new_email`).

**Cancel my order (§5)** — `POST /orders/{number}/cancel { reason? (max 500), email? }` (`customer.optional`, limited like the guest lookup).
- Who: the signed-in owner (no email needed) or anyone with the order's email (guests). Otherwise 404 `{ message: "We couldn't find an order with that number and email." }`.
- Allowed while `status` is `pending_payment` or `processing` **and** `payment_status` is `unpaid`, with no invoice and no shipment. Then: the existing cancel (stock back, coupon uses given back, open Stripe page closed), history "Cancelled by the customer." (+ " Reason: …", visible to the customer), email "Your order was cancelled" (template `order_cancelled_by_customer`) → 200 `{ data: order }` (the detail shape, with `history`).
- 422 `order`: "This order is already cancelled." / "This order has been paid or shipped, so it can't be cancelled online. Contact us to cancel it: support@…" (the store's support email).
- Every store order answer (`POST /orders`, `GET /orders`, `GET /orders/{number}`, lookup, pay, cancel) adds `can_cancel: bool`. The admin order resource has it too (ignore it there).

**Download my data (§6)** — `GET /me/export` (3 per hour per account; 429 after) → 200 `application/json`, `Content-Disposition: attachment; filename="buynest-my-data-YYYY-MM-DD.json"`:
```
{
  exported_at,
  profile: { first_name, last_name, email, pending_email, phone, email_verified_at, created_at, last_login_at, group: { name, discount_percent } | null },
  newsletter: { status: "subscribed"|"pending"|"unsubscribed"|"not_subscribed", subscribed_at | null, unsubscribed_at | null },
  addresses: [{ first_name, last_name, company, phone, line1, line2, city, state, postal_code, country, is_default_shipping, is_default_billing, created_at }],
  orders: [{ number, status, payment_status, payment_method, shipping_method, email, phone, shipping_address, billing_address, coupon_code, placed_at,
             items: [{ sku, name, variant_label, price, sale_price, quantity, line_total }], totals: { subtotal, discount, shipping, tax, total, paid, refunded },
             history: [{ status, note (only notes the customer was told; else null), created_at }],
             invoices: [{ number, amount, created_at }], shipments: [{ number, carrier, tracking_number, created_at }],
             refunds: [{ number, total, created_at }],
             returns: [{ number, status, reason, comment, resolution, created_at, items: [{ sku, name, variant_label, quantity }] }] }],
  reviews: [{ product, rating, title, comment, status, created_at }],
  saved_cart: { items: [{ product, variant, quantity }], updated_at } | null,
  stock_alerts: [{ product, variant, created_at, notified_at }]
}
```
No database ids, no staff notes or staff names, no other people's data.

**Delete my account (§6)** — `POST /me/delete { password, confirm: "DELETE" }` → 200 `{ message: "Your account was deleted." }`.
- 422 `password` "Your password is incorrect."; 422 `confirm` "Type DELETE to confirm."; 422 `account` "You have 1 open order (pending payment, processing, or shipped). You can delete your account once it's delivered or cancelled."
- Same rules and code as staff deletion (`App\Services\CustomerAccounts`): tokens, codes, addresses, notes, saved cart, stock alerts deleted; orders, reviews (author name), returns kept without the link; the newsletter address unsubscribed (the admin delete now does that too). The confirmation email (template `account_deleted`) goes to the old address. Audit `customer.deleted_own_account` (customer id only, no personal data).

## Implementation notes — part B (backend: photos, errors, backups, stock alerts)

Written before the code so the storefront and admin can start; the shapes below are what the API answers.

### §2 Resized product photos
- `product_images.variants` (json, null) and `products.thumbnail_variants` (json, null). In every answer they are an **object** keyed by width: `{}` (no copies: external URL, no GD, or the original is already that small) or `{ "320": "/media/products/12/<hex>-320.webp", "960": "/media/products/12/<hex>-960.webp" }`.
- Sizes are **maximum widths** (srcset `w` descriptors need the real width): a copy is only made when the original is **wider** than the size (never upscaled), height keeps the aspect ratio. Copies are re-encoded (metadata stripped): WebP when PHP's GD can write WebP, otherwise the original format. Names: `<same 32 hex>-320.<ext>` / `-960.<ext>` next to the original.
- Admin image item: `{ id, url, alt, position, is_upload, variants }`. Public product detail `images[]`: `{ url, alt, variants }`. Every product (store and admin, list and detail) adds `thumbnail_variants` (the first image's variants when the thumbnail is that image, else `{}`).
- Storefront: `srcset="<variants.320> 320w, <variants.960> 960w, <url> <original>w"` — the original's width isn't stored, so list the copies with `w` and keep `src=url` as the fallback (or add the original as a large descriptor such as `1600w`). With `{}`, just `src=url`.
- `/media` allow-list: `^products/\d+/[a-f0-9]{32}(-(320|960))?\.(jpg|png|webp)$`.
- Deleting an image deletes its copies. `php artisan buynest:images:resize [--force]` (run on the **api** service: the photo volume is there) makes copies for uploads without them (`--force`: all uploads again); without GD it prints "GD is not installed…" and exits 1.

### §3 Error alerts
- Sentry (`sentry/sentry-laravel`): on only when `SENTRY_LARAVEL_DSN` is set. Request bodies, cookies, query strings and headers other than `User-Agent`/`Accept`/`Content-Type` are dropped before sending; `send_default_pii=false`; user = `{ id, kind: "customer"|"admin" }` only. Optional `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`, `SENTRY_TRACES_SAMPLE_RATE` (default 0: errors only).
- `POST /api/v1/client-errors` — **always** needs `X-BuyNest-Bff` (403 `{ message, code: "store_only" }` without it, even in development, and when `BFF_SHARED_KEY` isn't set). Body: `{ message (required, ≤ 1000), stack (≤ 8192), url (≤ 2048; only the path is kept), app: "store"|"admin", release (≤ 64) }`. Answer **202** `{ "data": { "received": true, "duplicate": false } }`; the same app+message+first stack line again within 10 minutes → `duplicate: true` and not sent again. Rate limit `throttle:client-errors`: 10 per minute per visitor (the BFF passes the visitor IP as usual), 429 after. Email addresses and `token=`/`code=`/`password=`/`signature=`/`secret=`/`key=` values in the message and stack are replaced with `[scrubbed]`. Sent to Sentry as a message tagged `source=client`, `app=<app>`, with `release`; without Sentry it is written to the log at warning level.

### §3 Backups
- `php artisan buynest:backup` (`--list` prints the backups; `--trigger=schedule|cli`). Scheduled daily at 03:00 in `BACKUP_TIMEZONE` (default the app time zone, UTC), `withoutOverlapping()->onOneServer()`; turned off with `BACKUP_SCHEDULE=false`.
- Variables: `BACKUP_DISK` (`local` = `BACKUP_LOCAL_PATH`, default `storage/app/backups`; or `s3` = any S3-compatible bucket with `BACKUP_S3_KEY`, `BACKUP_S3_SECRET`, `BACKUP_S3_REGION` (default `auto`), `BACKUP_S3_BUCKET`, `BACKUP_S3_ENDPOINT`, `BACKUP_S3_PATH_STYLE`, `BACKUP_S3_PREFIX` (default `backups`)), `BACKUP_KEEP_DAYS` (default 14), `BACKUP_DUMP_BINARY` (default `mysqldump`).
- Files: `buynest-YYYYMMDD-HHMMSS.sql.gz` (UTC). Every run is recorded in `backup_runs`.
- Admin (all `backups.view`, Owner only by default):
  - `GET /api/admin/v1/backups` → `{ "data": [{ "name", "size_bytes", "created_at" }] (newest first), "meta": { "disk": "local"|"s3", "keep_days", "schedule": "03:00", "timezone": "UTC", "running": bool, "last_run": run|null } }`
  - run: `{ "id", "status": "running"|"ok"|"failed", "trigger": "schedule"|"admin"|"cli", "file_name"|null, "size_bytes"|null, "error"|null, "started_at", "finished_at"|null, "admin": { "id", "name" }|null }`
  - `POST /api/admin/v1/backups` ("Back up now", runs while the request waits, up to 5 minutes) → **201** `{ "data": run }`; already running → 422 `errors.backup` "A backup is already running. Try again in a few minutes."; failed → 422 `errors.backup` "The backup failed: <reason>" (the failed run is recorded and notified). Audited `backup.created`.
  - `POST /api/admin/v1/backups/{name}/link` → `{ "data": { "url": "/api/admin/v1/backups/{name}/download?expires=…&signature=…", "expires_at" } }` (a relative signed URL, valid 5 minutes; 404 for an unknown name).
  - `GET /api/admin/v1/backups/{name}/download?expires=…&signature=…` → the file (`Content-Type: application/gzip`, `Content-Disposition: attachment; filename=…`). Needs the admin token **and** a valid, unexpired signature (403 `{ message: "This download link has expired. Create a new one." }`). Audited `backup.downloaded`. The BFF passes the query string through unchanged (the signature covers the path and query).
- Failure: admin notification `backup_failed` (critical, permission `backups.view`, link `/system/backups`) and reported to Sentry.

### §7 Stock alerts
- "Available" = the product is for sale (active, visible category, not deleted) and the stock (the variant's, for a variant alert; the product's, which for a product with variants is the sum of its active variants) is at least the product's `min_order_quantity` (and ≥ 1); a variant must also be active.
- `POST /api/v1/products/{id}/stock-alerts` (customer token optional; `throttle:stock-alerts`: 10/min per visitor, 5/hour per email) `{ email?, variant_id? }` → **202** `{ "data": { "message": "Thanks! We'll email you once when it's back in stock." } }` every time (new, already listed, either way). Signed in: the account email is used (a sent `email` is ignored). 404 product not for sale; 422 `email` (guest without a valid address); 422 `variant_id` (not this product's, inactive, or sent for a product without variants); 422 `stock` "This item is in stock, so you can order it now." when it's available. A product with variants may be watched without `variant_id` only when every variant is sold out (any variant coming back sends it).
- `GET /api/v1/me/stock-alerts` (customer) → `{ "data": [{ "id", "product": { "id", "name", "thumbnail_url" }, "variant_id", "variant_label", "created_at" }] }` (waiting alerts of the account: its customer id or its email).
- `DELETE /api/v1/me/stock-alerts/{id}` → 204 (404 if not theirs).
- `POST /api/v1/stock-alerts/unsubscribe { token }` (`throttle:stock-alerts`) → `{ "data": { "removed": n } }` removes every waiting alert of that email; 422 `token` "This link isn't valid. …". The email link is `{STOREFRONT_URL}/stock-alerts/unsubscribe?token=<token>` (the storefront page posts it; tokens are `<id>.<40 chars>`, stored hashed).
- Email template `back_in_stock` (Marketing → Email templates): variables `product_name`, `variant_label`, `product_url` (url), `unsubscribe_url` (url), `button` (block); required `button` or `product_url`. Has a `List-Unsubscribe` header.
- Trigger: model events on products and variants (stock, status, `is_active`, `min_order_quantity` changes) check, after the transaction commits, for waiting alerts whose product/variant is now available — so the admin form, variant edits, bulk `set_stock`, CSV import, refunds with restock, cancellations, and received returns are all covered. Queued `SendStockAlertBatch` jobs of 100; each alert is claimed (`notified_at` set atomically) before sending, so it's emailed once.
- Admin `GET /api/admin/v1/reports/stock-alerts?q&limit(1–100, 25)&skip` (`reports.view`) → `{ "data": [{ "product": { "id", "name", "sku", "status", "stock_quantity", "thumbnail_url", "has_variants" }, "waiting", "variants": [{ "id", "sku", "label", "stock_quantity", "waiting" }], "oldest_at", "newest_at" }], "meta": { "total", "waiting_total", "notified_last_30_days", "limit", "skip" } }` — products with waiting alerts, most waiting first; `waiting` counts all of the product's alerts, `variants` lists only variants that have their own alerts.
- Admin product detail (`GET /products/{id}` and the answers that return the detail) adds `stock_alerts_waiting` (int).
- For part A: `App\Services\StockAlerts::forgetCustomer(Customer $customer): int` deletes every alert of that customer id or email (account deletion); `StockAlerts::forCustomer(Customer $customer)` returns the export items (`[{ product_name, variant_label, created_at, notified_at }]`).

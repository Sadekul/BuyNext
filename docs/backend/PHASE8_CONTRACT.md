# Phase 8 contract: Stripe card payments, real email, Railway hosting

**Status: built (2026-11-16).** Nothing is deployed and no real Stripe or email account is used yet; the owner adds the keys by following docs/DEPLOY_RAILWAY.md and docs/EMAIL.md.

Keeps the conventions of phases 1 to 7 (`snake_case`, money as 2-decimal strings, `{ data }`, Laravel 422 errors, `can.admin:<key>` on every admin route, audit entries for admin changes, emails through the template system).

## 1. Stripe card payments (test mode first)

Card details never touch BuyNest: shoppers pay on **Stripe Checkout** (Stripe's hosted payment page, which also offers Apple Pay and Google Pay where available), and BuyNest learns the result from a signed **webhook**.

### Settings and switches
- `.env` (backend): `STRIPE_SECRET_KEY` (`sk_test_…`), `STRIPE_WEBHOOK_SECRET` (`whsec_…`), `STRIPE_CURRENCY` (default `usd`), `STRIPE_CHECKOUT_MINUTES` (default 30, Stripe's minimum). Read through `config/buynest.php`, never `env()` in code.
- `Stripe` is **enabled** only when the secret key is set. Without it, card orders keep today's behaviour ("Awaiting payment" until an admin invoices). `GET /api/v1/store` adds `card_payments: "stripe" | "manual"`.
- Calls Stripe's REST API with Laravel's HTTP client (no SDK): `POST https://api.stripe.com/v1/checkout/sessions`, `POST /v1/refunds`, form-encoded, `Authorization: Bearer <secret>`, an `Idempotency-Key` on every POST (e.g. `order-{id}-session-{n}`, `memo-{id}`), 15 s timeout. Errors are logged without the key.

### Paying for an order
- `POST /api/v1/orders` with `payment_method: "card"` (Stripe enabled): the order is created as today (status `pending`, payment `unpaid`, stock reserved), then a Checkout Session is created for **the order's grand total as one line** ("BuyNest order BN-…", amount in cents), `customer_email`, `client_reference_id` = order number, `metadata[order_number]`, `expires_at` = now + checkout minutes, `success_url` = `{STOREFRONT_URL}/order-confirmation/{number}?payment=success`, `cancel_url` = `{STOREFRONT_URL}/order-confirmation/{number}?payment=cancelled`. The answer's `data` adds `payment: { provider: "stripe", url, expires_at }`. If Stripe can't be reached, the order still exists unpaid and the answer says `payment: { provider: "stripe", url: null, error: "…" }` so the shopper can retry.
- New `orders` columns: `payment_provider` null, `payment_reference` null (the PaymentIntent id), `payment_session_id` null, `payment_expires_at` null, `paid_at` null.
- `POST /api/v1/orders/{number}/pay` (the order's customer, or a guest with the order's email via the lookup proof the guest pages already use): a new session for an unpaid, not cancelled card order (refuses with 422 otherwise). Order pages show **Pay now** while that's possible.
- Admin-created orders with `card` get a session too, and the admin order page shows a **Payment link** to copy and send.

### Webhook
- `POST /api/v1/payments/stripe/webhook` (no auth, its own rate limit), raw body. Verifies the `Stripe-Signature` header (`t=…,v1=…`; HMAC-SHA256 of `"{t}.{raw body}"` with the webhook secret, constant-time compare, timestamp within 5 minutes) → 400 when invalid.
- `stripe_events` table (`id` = Stripe event id, `type`, `processed_at`): an event seen before answers 200 and does nothing (Stripe retries).
- `checkout.session.completed` with `payment_status: "paid"` (and `checkout.session.async_payment_succeeded`): finds the order by `metadata.order_number`, checks the amount and currency equal the order's, sets `payment_reference`, `paid_at`, and **creates the invoice** through the existing `OrderDocuments` service ("Paid by card through Stripe"), which emails the customer as an invoice does today. Already paid: no-op. Amount mismatch: logged, admin notification (critical), order left unpaid.
- `checkout.session.expired`: if the order is still unpaid and has no newer open session, **cancel it** through the existing cancel logic (restock, coupon uses given back, customer emailed "Payment not completed"), with a status-history note.
- Everything else: 200, ignored.

### Refunds
- A credit memo on a Stripe-paid order calls `POST /v1/refunds` (`payment_intent`, `amount` = memo total in cents) **before** saving the memo, inside the same transaction; Stripe refusing → 422 `{ message: "Stripe refused the refund: …" }` and nothing saved. The memo stores `refund_reference` (Stripe refund id). Memos on orders not paid through Stripe work as today (money returned by hand).
- The admin refund dialog says "The refund goes back to the customer's card through Stripe" for Stripe-paid orders.

### Storefront and admin
- Checkout with card (Stripe enabled): the place-order button reads "Continue to secure payment"; after the order is created the browser goes to Stripe's page. The confirmation page handles `?payment=success` ("Payment received — thank you", polling the order until it's paid, up to ~20 s, else "We're confirming your payment"), and `?payment=cancelled` ("Payment not completed" + **Pay now**).
- Order pages (account and guest tracking) show "Paid by card" / "Awaiting payment" + **Pay now**.
- Admin order page: payment provider, reference (linked to the Stripe dashboard test/live URL), paid at, payment link for unpaid card orders.
- The sign-in service forwards `POST /api/payments/stripe/webhook` to Laravel with the **raw, unchanged body** and the `Stripe-Signature` header (so the API itself needn't be public), and `POST /api/shop/orders/{number}/pay`.
- CSP: no change needed (leaving for Stripe is a top-level navigation).

## 2. Real email (Brevo or Mailgun over SMTP)

- No code change for sending: Laravel's SMTP mailer. Document the `.env` values for Brevo (`smtp-relay.brevo.com:587`, login + SMTP key) and Mailgun (`smtp.mailgun.org:587`, `postmaster@…` + password), `MAIL_FROM_ADDRESS` on a domain verified with the provider (SPF, DKIM, and DMARC records), `DEV_MAILBOX=false`.
- `php artisan buynest:mail-test {to}` sends one test email through the configured mailer and prints success or the error (without secrets).
- Queue: in production emails and newsletter batches go through the database queue (`QUEUE_CONNECTION=database`) with a worker running.

## 3. Hosting on Railway (API + MySQL) and Vercel (storefront + admin)

- `backend/Dockerfile` (PHP 8.4+ CLI or FPM image with pdo_mysql, bcmath, intl, zip, exif, fileinfo, opcache; composer install --no-dev --optimize-autoloader), `backend/railway.json` (or `railway.toml`), and `backend/docker/start.sh` that runs `php artisan migrate --force`, `storage:link`, `config:cache`, `route:cache`, `view:cache`, then serves the app. Separate Railway services (same image, different start commands) for the **queue worker** (`queue:work --tries=3`) and the **scheduler** (`schedule:work`).
- A Railway **volume** mounted at `storage/app/public` for product photos.
- `docs/DEPLOY_RAILWAY.md`: a click-by-click guide (create project, MySQL plugin, variables list with what each is, volume, three services, the domain, then the Vercel settings for the storefront: `BUYNEST_LARAVEL_URL`, `BUYNEST_BFF_KEY`, `VITE_*`), the Stripe webhook URL to register (`https://<store>/api/payments/stripe/webhook`, events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`), the Brevo/Mailgun DNS records, and a post-deploy checklist.
- Nothing is deployed and no account is touched by us: the owner runs the steps.

## Tests
Backend feature tests with `Http::fake()` for Stripe (session created with the right amount, currency, URLs, metadata, idempotency key; Stripe down → order unpaid with retry; pay-again rules; webhook signature valid / invalid / stale; duplicate event; amount mismatch; expired session cancels and restocks once; refund calls Stripe and Stripe refusing saves nothing; Stripe disabled → old behaviour). Storefront and admin unit tests; a browser check of the checkout redirect and the success/cancel pages using a signed test webhook sent by the e2e script (no real Stripe calls in tests).

## Implementation notes — backend (Stripe and mail test)

Backend choices for §1 and the `buynest:mail-test` part of §2. Paths are under `/api/v1` (store) or `/api/admin/v1` (admin). Money is a `"0.00"` string, dates ISO 8601 UTC (`Z`).

**Switches**
- `config('buynest.stripe')`: `secret_key` (`STRIPE_SECRET_KEY`), `webhook_secret` (`STRIPE_WEBHOOK_SECRET`), `currency` (`STRIPE_CURRENCY`, lower-case, default `usd`), `checkout_minutes` (`STRIPE_CHECKOUT_MINUTES`, clamped to Stripe's 30–1440, default 30), `admin_link_minutes` (1440: payment links staff send stay open 24 hours), 15 s timeout, 5-minute webhook tolerance, `BUYNEST_STRIPE_WEBHOOKS_PER_MINUTE` (300).
- Stripe is **on** only when `STRIPE_SECRET_KEY` is set. Off: nothing below runs, no Stripe call is ever made, card orders behave exactly as in phase 7 (`pending_payment` / `unpaid` until staff invoice), and `payment` (below) is `{ provider: null, paid_at: null, url: null, expires_at: null, can_pay: false }` for unpaid card orders.
- `GET /store` adds `card_payments: "stripe" | "manual"`.
- Code: `App\Services\Payments\StripeGateway` (the only class that calls Stripe: HTTP client, form encoding with bracketed keys, `Authorization: Bearer`, `Idempotency-Key` on every POST, signature check), `App\Services\Payments\StripePayments` (sessions, webhook handling, refunds).
- Order status names are unchanged: a card order waiting for its payment is `pending_payment` (the contract's "pending").

**`payment` on every order answer** (store `OrderResource`: create, `GET /orders/{number}`, `GET /orders`, `POST /orders/lookup`, `/pay`; admin `AdminOrderResource`)
```
payment: {
  provider: "stripe" | null,   // "stripe" once a payment page was opened (or Stripe took the payment)
  paid_at: ISO | null,         // when Stripe reported the payment (null for orders paid by hand)
  url: string | null,          // the open Stripe payment page (null when none is open, or not payable)
  expires_at: ISO | null,      // when that page closes
  can_pay: bool,               // show "Pay now": Stripe on, payment_method "card", payment_status "unpaid", status "pending_payment"
  error?: string,              // only on the answer of a create / pay / payment-link call where Stripe failed (url is then null)
  // admin only:
  reference: string | null,    // the Stripe PaymentIntent id (pi_...)
  dashboard_url: string | null // https://dashboard.stripe.com/test/payments/pi_... (no /test/ with an sk_live_ key)
}
```

**Placing a card order** — `POST /orders` (unchanged body, `payment_method: "card"`) → 201 as before; with Stripe on, `data.payment` is `{ provider: "stripe", url, expires_at, can_pay: true, paid_at: null }`: send the browser to `url`. Stripe failing (down, timeout, refusal): still 201, the order exists unpaid with stock reserved, `data.payment.url: null` and `data.payment.error: "Stripe could not be reached. Please try again in a moment."` (or Stripe's message) → show **Pay now**.
- The session: one line "`{store name}` order BN-…" for the grand total in cents, `quantity 1`, `customer_email`, `client_reference_id` and `metadata[order_number]` (also on the PaymentIntent) = the order number, `expires_at` = now + checkout minutes, `success_url` = `{STOREFRONT_URL}/order-confirmation/{number}?payment=success`, `cancel_url` = `…?payment=cancelled`. Idempotency key `order-{id}-session-{n}` (n counts the order's attempts).
- The order-confirmation email says to complete the payment on the secure page (and that "Pay now" is on the order page).

**Pay now** — `POST /orders/{number}/pay` `{ email? }` (`customer.optional`, rate limit like the guest lookup)
- Who: the signed-in customer who owns the order (Bearer token, no email needed), or anyone sending the order's `email` (the guest lookup's proof, case-insensitive). Otherwise 404 `{ message: "We couldn't find an order with that number and email." }` (same as the lookup).
- 422 `{ message, errors: { order: [...] } }` when it can't be paid online: "Online card payments aren't available right now. …" (Stripe off), "This order isn't paid by card.", "This order has already been paid.", "This order was cancelled, so it can't be paid.", "This order isn't waiting for a payment.".
- 200 `{ data: OrderResource }` with `data.payment` as above: the page still open (more than 2 minutes left) is given back, otherwise a new one is opened (a new session id). Stripe failing → 200 with `payment.url: null` + `payment.error`.

**Webhook** — `POST /payments/stripe/webhook` (no auth, `throttle:stripe-webhooks`). Send the **raw body unchanged** and the `Stripe-Signature` header.
- Signature: `t=…,v1=…[,v1=…]`; HMAC-SHA256 of `"{t}.{raw body}"` with `STRIPE_WEBHOOK_SECRET`, constant-time compare, any `v1` may match, `|now − t| ≤ 300 s`. Invalid / missing / stale / no secret configured → **400** `{ message: "Invalid Stripe signature." }`.
- Valid → **200** `{ received: true, result }`; `result` (for logs and tests): `paid`, `cancelled`, `duplicate` (event id seen before, `stripe_events`), `already_paid`, `amount_mismatch`, `cancelled_order`, `superseded`, `awaiting_payment`, `unknown_order`, `ignored`. Each event id is handled once; if handling throws, nothing (not even the event row) is kept and Stripe retries.
- `checkout.session.completed` with `payment_status: "paid"`, or `checkout.session.async_payment_succeeded`: the order (by `metadata.order_number`, else `client_reference_id`) is locked; amount (`amount_total` in cents) and currency must equal the grand total and `STRIPE_CURRENCY` → `payment_provider "stripe"`, `payment_reference` = PaymentIntent id, `paid_at`, then the invoice through `OrderDocuments::invoice` (no admin; invoice note "Paid by card through Stripe."; history "Invoice INV-… created; payment of $… recorded. Paid by card through Stripe."): `paid`, `pending_payment → processing`, the "Payment received" invoice email to the customer.
  - Mismatch: logged, order left unpaid, an internal history note, and an admin notification **`payment_problem`** (severity `critical`, permission `orders.view`, link `/orders/{number}`).
  - Already paid by this PaymentIntent: no-op. Paid by something else (staff invoiced it, or a second session was paid): `payment_problem` notification ("refund it in the Stripe dashboard"). Order cancelled: `payment_problem` notification too.
- `checkout.session.expired`: only if the order is still `pending_payment`/`unpaid`, a card order, and the expired session **is the order's current one** (otherwise `superseded`): cancelled through `OrderDocuments::cancel` (stock back, coupon uses given back, once), history "Payment not completed: the secure payment page expired. Order cancelled; items returned to stock." (customer-visible, no admin), and the new **"Payment not completed"** email (template `payment_not_completed`: variables `customer_first_name`, `order_number`, `order_total`, `shop_url`, `button`).
- Everything else: 200, `ignored`.
- Staff cancelling a card order (PATCH or bulk) also closes its open Stripe page (`POST /v1/checkout/sessions/{id}/expire`, best effort), so it can't be paid after.

**Refunds** — `POST /api/admin/v1/orders/{number}/credit-memos` unchanged. On an order paid through Stripe (`payment_provider "stripe"` with a `payment_reference`) the memo total is refunded with `POST /v1/refunds` (`payment_intent`, `amount` in cents, `metadata[order_number]`, idempotency key `memo-order-{order id}-{memo count + 1}-{cents}`) **before** the memo is saved, inside its transaction. Stripe refusing / unreachable → **422** `{ message: "Stripe refused the refund: …", errors: { refund: ["Stripe refused the refund: …"] } }` and nothing is saved (no memo, no restock, no status change). Credit memo answers add `refund_reference` (the Stripe refund id `re_…`, or null when refunded by hand). The history note then says "…refunded to the card through Stripe." Orders invoiced by hand work as before (no Stripe call). Admin UI: show "The refund goes back to the customer's card through Stripe" when `payment.provider === "stripe" && payment.reference`.

**Admin payment links**
- `POST /api/admin/v1/orders` with `payment_method: "card"` (Stripe on) → 201 with `data.payment.url` (open 24 hours) to copy and send; `error` instead when Stripe failed.
- `POST /api/admin/v1/orders/{number}/payment-link` [`orders.edit`] → 200 `{ data: AdminOrderResource }` with `data.payment.url`: the open link, or a new one (24 hours); audit `order.payment_link_created`. 404 unknown order; 422 `{ errors: { order } }` as for Pay now. Show it on the order page while `payment.can_pay` (the URL from `GET /orders/{number}` is null once the link expired → offer "New payment link").
- Note: when a link expires unpaid the order is cancelled (the webhook above), for admin orders too.

**Database** — `orders`: `payment_provider`, `payment_reference`, `payment_session_id` (indexed), `payment_url`, `payment_expires_at`, `payment_attempts`, `paid_at`; `credit_memos.refund_reference`; `stripe_events (id = evt_…, type, processed_at, created_at)`. Migration `2026_11_18_000100_add_stripe_payments`.

**Mail test** — `php artisan buynest:mail-test {to}` sends one plain test email through `MAIL_MAILER`, prints "Sent. …" (exit 0) or "Sending failed: …" with the SMTP login and password removed (exit 1); warns that `log`/`array` mailers don't deliver.

**For the sign-in service (BFF) and the e2e script**
- Forward `POST /api/payments/stripe/webhook` → `POST {LARAVEL}/api/v1/payments/stripe/webhook` with the raw body bytes and the `Stripe-Signature` header (don't parse and re-serialize JSON: the signature covers the exact bytes). Pass the status and body back.
- Forward `POST /api/shop/orders/{number}/pay` → `POST /api/v1/orders/{number}/pay` with the customer's token if signed in, and `{ email }` for guests.
- A signed test webhook: `t = unix seconds`, header `t={t},v1=` + hex HMAC-SHA256 of `"{t}.{body}"` with `STRIPE_WEBHOOK_SECRET` (PHP: `App\Services\Payments\StripeGateway::signature($body, $secret)`). Minimal paid event body: `{ "id": "evt_…", "type": "checkout.session.completed", "data": { "object": { "id": "<the order's session id>", "object": "checkout.session", "amount_total": <cents>, "currency": "usd", "payment_status": "paid", "payment_intent": "pi_…", "metadata": { "order_number": "BN-…" } } } }`. The webhook needs only `STRIPE_WEBHOOK_SECRET` (it works with Stripe's key unset: a signed paid event for an unpaid card order invoices it), so an e2e run can test the success/cancel pages and the paid state without any Stripe call; the redirect to Stripe itself needs `STRIPE_SECRET_KEY` (a real test key, or intercept the browser's call to the API answer and check `payment.url`). Never point tests at the real API.

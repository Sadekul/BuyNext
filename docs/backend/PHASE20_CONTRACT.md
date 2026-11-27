# Phase 20 contract: SMS notifications for orders

**Status: built (2026-11-27)** — see the SQA report (Phase 20). Asked by the store owner ("ok should start", after SMS order notifications were recommended). In Bangladesh most orders are cash on delivery and customers read SMS more than email: a text at each step (placed, confirmed, shipped with tracking, delivered, cancelled), plus a **one-tap confirmation link** for cash-on-delivery orders that fills the "To confirm" list without a phone call.

## Ground rules (every builder)

- **Off by default.** With SMS off, nothing changes (every existing test and browser suite passes unchanged).
- **No real SMS, ever, in development or tests.** A `log` driver (the default) stores every message in the database and shows it in a dev **SMS inbox** (like `/dev/mailbox`); real providers are called only when their credentials are in `backend/.env` and the admin picks them. Feature tests use `Http::fake()` + `Http::preventStrayRequests()`; the browser suite uses the log driver (and a local stand-in only if it tests a provider).
- **Provider wire formats are from the providers' public docs and community SDKs, not yet verified with a real account**: say so in each driver's docblock and in `docs/BANGLADESH.md`, with "send a test SMS from Settings → SMS before going live" as a launch step. One class per provider.
- **Only order texts (transactional).** No marketing SMS in this phase.
- A failed SMS never blocks or rolls back the order action that triggered it; it is logged as failed and can be retried.
- English + Bangla (customer's language, else the order's / request's locale; Bangla digits where the store uses them). Money through `Pricing` / `Currency`.
- Never read or edit `.env` / `.env.local`; agents never run state-changing git commands; no 0-byte files; never change or delete `admin@buynest.test`, `customer@buynest.test` (Ava), `shopper2@buynest.test` (Ben); never enable two-step.

## 1. Backend (Laravel)

### Config and settings

`config/buynest.php` → `sms`: `driver` default (`log`), `ssl_wireless` (`api_token`, `sid`, `api_url` default `https://smsplus.sslwireless.com`), `bulksmsbd` (`api_key`, `sender_id`, `api_url` default `http://bulksmsbd.net/api`). Env: `SMS_SSL_WIRELESS_API_TOKEN, SMS_SSL_WIRELESS_SID, SMS_SSL_WIRELESS_API_URL, SMS_BULKSMSBD_API_KEY, SMS_BULKSMSBD_SENDER_ID, SMS_BULKSMSBD_API_URL` (names only, empty, in `.env.example`).

Settings (admin-editable): `sms_enabled` (false), `sms_provider` (`log|ssl_wireless|bulksmsbd`, default `log`; a provider without credentials can't be chosen: 422), `sms_events` (default all on when enabled: `order_placed, cod_confirm_request, order_confirmed, order_shipped, order_delivered, order_cancelled`), `sms_templates` (per event, `en` and `bn`; defaults below; empty = default), `sms_confirm_link` (true: the COD confirm request carries the one-tap link).

### Data — migration `2026_11_27_000100_add_sms`

- `sms_messages`: `id, order_id (fk nullable, null on delete), event (string 40, nullable for test sends), to (string 20, +8801XXXXXXXXX), body (text), locale (2), segments (tinyint), encoding (gsm|unicode), provider (string 20), status (queued|sent|failed), provider_message_id (nullable), error (nullable string 300), attempts (tinyint default 0), sent_at (nullable), admin_id (nullable, for test sends), created_at, updated_at`. Index `(order_id)`, `(status, created_at)`. Model `SmsMessage`. Prune log-driver rows older than 90 days with `model:prune` (keep real-provider rows 1 year).
- `orders` gains `sms_confirm_token_hash` (string 64 nullable, indexed) and `sms_confirm_expires_at` (timestamp nullable).

### Services — `app/Services/Sms/`

- `SmsDriver` interface: `key()`, `label()`, `configured()`, `send(string $to, string $body, string $reference): SmsResult` (`messageId|null`, `ok`, `error|null`). `SmsException` with a safe message; never log credentials or full message bodies (log the message id, status and provider reason).
- `LogDriver` (always configured; marks sent, id `log-{id}`).
- `SslWirelessDriver`: `POST {api}/api/v3/send-sms` JSON `{api_token, sid, msisdn (8801XXXXXXXXX), sms, csms_id (unique reference ≤ 20 chars)}` → success when `status == "SUCCESS"` (and `status_code == 200`); `smsinfo[0].sms_status` / `reference_id` as the id; else error from `error_message`.
- `BulkSmsBdDriver`: `GET/POST {api}/smsapi?api_key&type=text|unicode&number=8801XXXXXXXXX&senderid&message` → JSON `{response_code, success_message|error_message}`; success when `response_code == 202`.
- `SmsText::measure(string $body): {encoding, segments, length}` — GSM-7 (160 / 153 per part) vs Unicode (70 / 67 per part; any Bangla makes it Unicode).
- `Sms` service: `sendForOrder(Order, string $event, array $extra = [])` — skip unless enabled, the event is on, the order has a Bangladeshi mobile (convert `01…`/`+8801…`; anything else → skip with a log line, no row), not already sent for this order+event (idempotent; `order_shipped` keyed per shipment), render the template with variables, create the row (`queued`), send **after the DB commit**, update `sent`/`failed`. `sendTest(Admin, string $to, ?string $body)`. `retry(SmsMessage)` (failed only, max 5 attempts).

### Templates (defaults; staff can edit; variables in `{braces}`)

Variables: `{store}`, `{order}`, `{total}`, `{name}`, `{courier}`, `{tracking}`, `{tracking_url}`, `{confirm_url}`, `{order_url}`. Unknown variables are left out (and the admin shows a warning while editing). Keep defaults short (English ≤ 160 GSM chars where possible; Bangla ≤ 2 Unicode parts).

| Event | When | English default |
|---|---|---|
| `order_placed` | the order is placed and isn't waiting for online payment (COD, bank transfer…), or when an online payment completes | `{store}: order {order} received, total {total}. We'll text you when it ships.` |
| `cod_confirm_request` | a COD order that needs confirmation (`cod_require_confirmation` on), sent instead of `order_placed` | `{store}: please confirm your order {order} ({total}, cash on delivery): {confirm_url}` |
| `order_confirmed` | confirmation becomes `confirmed` (staff, or the link) | `{store}: order {order} is confirmed. We'll text you when it ships.` |
| `order_shipped` | a shipment is created **with** "notify the customer" (manual, courier, bulk) | `{store}: order {order} is on its way with {courier}. Track: {tracking_url}` (no tracking → `…with {courier}.`) |
| `order_delivered` | the order becomes delivered with the customer notified (staff or courier report) | `{store}: order {order} was delivered. Thank you for shopping with us!` |
| `order_cancelled` | the order becomes cancelled with the customer notified (staff, confirmation outcome, customer) | `{store}: order {order} was cancelled. Questions? Reply or call us.` |

Bangla defaults written in the same plain style (the store owner will review them). **Hook placement:** send at the same moments the matching customer email goes today and respect the same "notify the customer" choice (`customer_notified` on history rows and shipments). Prefer one place per event (e.g. observers on `OrderStatusHistory` / `Shipment` with `afterCommit`, plus `Checkout` / payment completion for `order_placed`) over adding calls next to each `Mail::to` — list in the report exactly where each event is triggered.

### One-tap confirmation link

- When `cod_confirm_request` is sent with `sms_confirm_link` on: a random token (32+ bytes, URL-safe), its SHA-256 stored on the order, expiry 72 h. `{confirm_url}` = `{STOREFRONT_URL}/c/{token}` (short on purpose).
- Storefront API: `GET /api/v1/order-confirmations/{token}` → `{data: {number, total, items_count, placed_at, status: pending|confirmed|cancelled|expired|not_waiting}}` (no address, no phone, no name). `POST /api/v1/order-confirmations/{token}` `{action: confirm|cancel, reason?}`:
  - `confirm` → the same effect as staff choosing "confirmed" (log outcome with note "Confirmed by the customer from the SMS link", `admin_id` null, actor "Customer (SMS link)"), `CodConfirmedMail` as today, `order_confirmed` SMS.
  - `cancel` → only while the order can still be cancelled by the existing confirmation rules (not shipped, not invoiced) → the same effect as the confirmation outcome "cancelled" with reason "Cancelled by the customer from the SMS link" (restock, email, SMS).
  - Token single-purpose: after confirm or cancel it stops working (`status` shows the result). Expired / unknown → 404 with a plain message. Throttle `throttle:20,1`. **A GET never changes anything** (link previews and SMS app scanners open links).
- Audit both actions (no admin).

### Admin API (`/api/admin/v1`)

- `GET sms` (`settings.view`) → `{data: {settings, providers: [{key, label, configured}], stats: {sent_today, failed_today, sent_30d}, defaults: {templates}}}`.
- `PUT sms/settings` (`settings.edit`, partial) → validated (templates ≤ 480 chars; a provider must be configured; at least one event when enabled) → same shape; audit.
- `POST sms/test` (`settings.edit`) `{to, body?}` → sends through the chosen provider (log driver in dev) → `{data: SmsMessageResource}`; 422 for a bad number.
- `GET sms/messages?status&event&search&page` (`orders.view`) → paginated `{id, order: {number}|null, event, to (masked except last 4 for staff without orders.view? — keep full for orders.view), body, locale, segments, encoding, provider, status, error, attempts, sent_at, created_at}`.
- `POST sms/messages/{id}/retry` (`orders.edit`).
- `AdminOrderResource` gains `sms: [{event, status, to, sent_at, error}]`.

### Dev SMS inbox

`/dev/sms` (web route, only when `app.env` is local/testing, like the mailbox): newest first, phone, event, body, status; JSON `/dev/sms/latest?to=` for the browser suite.

### Command

`buynest:sms:retry` (failed rows of the last 24 h, ≤ 5 attempts, scheduled every 10 minutes when SMS is enabled; `--dry-run`).

### Tests (feature)

Off → nothing sent anywhere. On with log driver: each event at the right moment and only once; "don't notify" choices respected; non-Bangladeshi phone skipped; Bangla templates and digits for a Bangla customer; segment counting (GSM vs Unicode); template variables and unknown-variable handling; providers via `Http::fake()` (request shape, success, error → failed row, retry); provider without credentials can't be chosen; confirm link: GET changes nothing, confirm, cancel (restock, emails, SMS), cancel refused after shipping, expired / reused token, throttle; admin endpoints and permissions; dev inbox only in local/testing; Pint clean.

## 2. Admin app

- **Settings → SMS** page (Settings section, `settings.view` to see, `settings.edit` to change): on/off switch; provider choice (radio cards with "Set up" / "Not set up" badges; Log = "Test mode: messages are only saved, not sent"); "How to set up" with env variable names only; event checkboxes with plain descriptions; "Include a one-tap confirmation link" checkbox; **template editor** per event with English / বাংলা tabs, a variables list (click to insert), a live counter ("72 characters · 1 SMS" / "Unicode (Bangla): 2 SMS"), unknown-variable warning, "Reset to default"; **Send a test SMS** (number + optional text → shows the result); Save → "SMS settings saved."; stats (sent today, failed today, last 30 days).
- **SMS log** page (Sales or Reports section, `orders.view`): table (time, phone, order link, event, status in words, parts, error), filters (status, event), search, Retry button on failed rows (`orders.edit`).
- **Order page**: an "SMS" panel listing texts sent for the order (event, status, time; failed ones with Retry).
- BFF (`frontend/server`): proxy routes + mapping for every admin endpoint above, tests in the existing style.
- Unit tests (`Phase20.test.jsx`).

## 3. Storefront

- **Confirmation page** `/c/:token` (short route; also add it to the BFF / router so a hard reload works): loads the order summary (number, total, items count, date) → two buttons "Confirm my order" (primary) and "Cancel this order" (secondary, asks for an optional reason in a small dialog and a second confirm) → result messages: "Thank you, your order BN-… is confirmed. We'll text you when it ships." / "Your order BN-… is cancelled." Already-done / expired / not-waiting states with clear text and a link to "Track your order". English + Bangla (from the cookie / customer; a small language switch on the page), works at 390px, accessible (buttons, `role="status"` results, focus moves to the result).
- **Checkout**: when SMS is on (expose `sms_updates: true` in `/store`), a short line near the phone field: "We'll text order updates to this number." (Bangla too). Nothing when off.
- BFF: proxy `GET/POST /api/v1/order-confirmations/{token}` (rate-limited, no auth), pass `sms_updates` through the `/store` mapping (watch the whitelists), tests.
- Unit tests for the page states and the checkout line.

## 4. Browser suite `e2e/sms.mjs` (after `welcome` in `run-all.mjs`)

Turn SMS on with the log driver and confirmation required (put every setting back afterwards); place a COD order with a Bangladeshi mobile → `cod_confirm_request` text in the dev SMS inbox with a link → open it (GET shows the summary, nothing changes) → Confirm → order confirmed in the admin, `order_confirmed` text; another order → Cancel from the link → cancelled and restocked; ship one (manual shipment with notify) → `order_shipped` text with tracking; mark delivered → `order_delivered`; "don't notify" sends nothing; admin SMS settings page (template counter in Bangla shows Unicode parts, test SMS appears in the inbox), SMS log with filters, order page SMS panel; SMS off → nothing sent; axe + 390px on the confirmation page (both languages) and the settings page; cleanup.

## 5. Docs

`docs/BANGLADESH.md` (SMS section: providers, env names, events, confirm link, launch step), README row B22, SQA section, LEARNING_LOG, `docs/I18N.md` (SMS wording), this contract marked built.

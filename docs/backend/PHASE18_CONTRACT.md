# Phase 18 contract: courier integration (Steadfast and Pathao)

**Status: built (2026-11-25)** — see the SQA report (Phase 18). Asked by the store owner after the Bangladesh delivery work: staff book a courier from an order, the tracking number is saved, customers follow the parcel, and a delivered cash-on-delivery parcel records the cash and marks the order paid.

**Couriers:** Steadfast (Packzy) and Pathao, the two most used by Bangladeshi online shops, both with merchant APIs. RedX, Paperfly and Sundarban are added as **manual carriers** (tracking number typed by staff, tracking page link) — their APIs can follow later with the same driver interface.

## Ground rules (every builder)

- **No real calls to any courier, ever, in development or tests.** Unit and feature tests use `Http::fake()`; the browser suite starts a local stand-in courier server and a second API process whose environment points at it (exactly like `e2e/taka.mjs` does for SSLCommerz). Without credentials a courier is simply "not set up" and everything else works as before.
- **Credentials only in `backend/.env`** (never committed, never read or edited by agents). Add the variable *names* with empty values to `backend/.env.example` and document them in `docs/BANGLADESH.md`.
- **API details are from the couriers' published merchant APIs and community SDKs; not yet verified against a real sandbox account.** Every gateway class says so in its docblock, and `docs/BANGLADESH.md` lists "verify with sandbox credentials before going live" as a launch step. Keep each courier's wire format inside its one gateway class, so a correction is a one-file change.
- Everything from phases 1–17 keeps working: the manual shipment form, packing slips, the courier CSV, COD collection, OrderStatusMail / ShipmentMail, English + Bangla (Bangla digits), phones, WCAG 2.1 AA, honest data.
- Money in cents internally, formatted with `Pricing` / `Currency` like the rest of the code. Store currency is taka for couriers; if the store currency isn't BDT, courier booking is refused with a clear message (couriers collect taka).
- Agents never run state-changing git commands. No 0-byte files.

## 1. Backend (Laravel)

### Config — `config/buynest.php` → `couriers`

```
steadfast: api_key, secret_key, api_url (env STEADFAST_API_URL, default https://portal.packzy.com/api/v1), webhook_token
pathao:    client_id, client_secret, username, password, store_id,
           mode (sandbox|live), api_url (env PATHAO_API_URL, else sandbox https://courier-api-sandbox.pathao.com / live https://api-hermes.pathao.com),
           webhook_secret
```
Env names: `STEADFAST_API_KEY, STEADFAST_SECRET_KEY, STEADFAST_API_URL, STEADFAST_WEBHOOK_TOKEN, PATHAO_CLIENT_ID, PATHAO_CLIENT_SECRET, PATHAO_USERNAME, PATHAO_PASSWORD, PATHAO_STORE_ID, PATHAO_MODE, PATHAO_API_URL, PATHAO_WEBHOOK_SECRET`.

Settings (admin-editable, `Settings` service, Settings → Couriers): `courier_default` (`null|steadfast|pathao`), `courier_auto_sync` (bool, default true), `courier_note_template` (nullable string ≤ 200, e.g. "Handle with care"), `courier_pathao_item_type` (`parcel|document`, default parcel), `courier_pathao_delivery_type` (`normal|on_demand`, default normal). The existing `default_weight_grams` is reused.

### Carriers — `Shipment::CARRIERS`

Add (keep the existing ones): `steadfast` (label "Steadfast", tracking `https://steadfast.com.bd/t/{n}` using the **tracking code**), `pathao` ("Pathao", `https://merchant.pathao.com/tracking?consignment_id={n}`), `redx` ("RedX", `https://redx.com.bd/track-parcel/?trackingId={n}`), `paperfly` ("Paperfly", null), `sundarban` ("Sundarban Courier", null). Update the `carrier.in` message to list them. Mark the tracking URL patterns as "to verify" in a comment.

### Migration `2026_11_25_000200_add_courier_bookings`

`shipments` gains (all nullable unless stated):
- `courier_consignment_id` string(60), indexed with `carrier` (unique per carrier)
- `courier_status` string(60) — the courier's own raw status
- `delivery_status` string(20), not null, default `'shipped'` — our normalised status, one of `Shipment::DELIVERY_STATUSES = ['booked','picked_up','in_transit','out_for_delivery','delivered','partly_delivered','on_hold','returned','cancelled','shipped']` (`shipped` = manual shipment without courier updates; old rows get it)
- `cod_amount_cents` unsigned int — what the courier was asked to collect
- `courier_fee_cents` unsigned int — the courier's charge when it reports one
- `collected_cents` unsigned int — the cash the courier reports collected
- `booked_via_api` bool not null default false
- `status_updated_at` timestamp, `last_synced_at` timestamp

New table `shipment_events`: `id, shipment_id (fk cascade), delivery_status, courier_status (nullable), message (nullable string 500), source enum('booking','webhook','sync','staff'), occurred_at timestamp, created_at`. Index `(shipment_id, occurred_at)`. Model `ShipmentEvent`; `Shipment::events()` ordered oldest first.

### Driver interface — `app/Services/Couriers/`

- `CourierGateway` interface: `key(): string`, `label(): string`, `configured(): bool`, `book(array $parcel): BookingResult`, `status(Shipment $s): StatusResult`, `balanceCents(): ?int` (null if the courier has no such call), `normalise(string $raw): string` (raw → one of `DELIVERY_STATUSES`).
- `BookingResult` (consignment_id, tracking_code, courier_status, fee_cents|null) and `StatusResult` (courier_status, delivery_status, collected_cents|null, fee_cents|null, message|null) small readonly classes.
- `CourierException` with a safe, translatable message; failures are logged with the courier's status and reason only — **never credentials, never the full recipient data**.
- Laravel HTTP client with `timeout(20)` and `connectTimeout(5)`.

**`SteadfastGateway`** (headers `Api-Key`, `Secret-Key`, `Content-Type: application/json`):
- Book: `POST {api}/create_order` `{invoice, recipient_name, recipient_phone (11 digits 01XXXXXXXXX), recipient_address (≤ 250), cod_amount (number, taka), note}` → `{status: 200, consignment: {consignment_id, tracking_code, status}}`. Non-200 `status` or missing consignment → `CourierException` with the courier's `message` / first error.
- Status: `GET {api}/status_by_cid/{consignment_id}` → `{status: 200, delivery_status}`.
- Balance: `GET {api}/get_balance` → `{status: 200, current_balance}`.
- Raw statuses → ours: `pending|in_review → booked`, `hold → on_hold`, `delivered|delivered_approval_pending → delivered`, `partial_delivered|partial_delivered_approval_pending → partly_delivered`, `cancelled|cancelled_approval_pending → cancelled`, `unknown|unknown_approval_pending → on_hold` (message "The courier needs to check this parcel"); anything else → `in_transit`.
- Webhook (Steadfast posts to our URL with `Authorization: Bearer {webhook_token}`): JSON `{notification_type: "delivery_status"|"tracking_update", consignment_id, invoice, cod_amount, status, delivery_charge, tracking_message, updated_at}`. Reply `{status: "success", message: "Webhook received successfully."}` 200.

**`PathaoGateway`** (OAuth password grant):
- Token: `POST {api}/aladdin/api/v1/issue-token` `{client_id, client_secret, username, password, grant_type: "password"}` → `{access_token, refresh_token, expires_in}`. Cache the access token (`Cache`, key `couriers.pathao.token`, TTL `expires_in − 300`); on a 401 drop it and retry once. Never log tokens.
- Locations (cached 24 h, `Bearer` token): `GET /aladdin/api/v1/city-list` → `data.data[{city_id, city_name}]`; `GET /aladdin/api/v1/cities/{city}/zone-list` → `data.data[{zone_id, zone_name}]`; `GET /aladdin/api/v1/zones/{zone}/area-list` → `data.data[{area_id, area_name, home_delivery_available, pickup_available}]`.
- Book: `POST /aladdin/api/v1/orders` `{store_id, merchant_order_id (our order number), recipient_name, recipient_phone, recipient_address, recipient_city, recipient_zone, recipient_area?, delivery_type (48 normal | 12 on demand), item_type (2 parcel | 1 document), special_instruction?, item_quantity, item_weight (kg, 0.5–10), amount_to_collect (integer taka), item_description?}` → `{code: 200, data: {consignment_id, merchant_order_id, order_status, delivery_fee}}`. Validation errors come back as `{code: 422, errors: {field: [..]}}` → `CourierException` with the first error.
- Status: `GET /aladdin/api/v1/orders/{consignment_id}/info` → `data.order_status` (+ `order_status_slug`).
- Raw statuses (case-insensitive, slug or text) → ours: `pending → booked`, `pickup_requested|assigned_for_pickup → booked`, `picked|pickup_success → picked_up`, `at_the_sorting_hub|in_transit|received_at_last_mile_hub|assigned_for_delivery → in_transit` (assigned_for_delivery → `out_for_delivery`), `delivered → delivered`, `partial_delivery → partly_delivered`, `on_hold|delivery_failed|pickup_failed → on_hold`, `return|returned|paid_return|exchange → returned`, `pickup_cancelled|cancelled → cancelled`; else `in_transit`.
- Webhook: Pathao posts JSON `{consignment_id, merchant_order_id, event, order_status, collected_amount?, delivery_fee?, updated_at}` with header `X-PATHAO-Signature` = our `webhook_secret`. We must answer **202** with header `X-Pathao-Merchant-Webhook-Integration-Secret: {webhook_secret}` (Pathao's integration check, also sent as `event: "webhook_integration"`).
- `balanceCents()` → null.

`Couriers` service (`app/Services/Couriers/Couriers.php`) resolves gateways by key, lists them for the admin (`key, label, configured, mode` — never secrets), builds the parcel from an order, books, applies updates.

### Booking — `Couriers::book(Order, Admin, string $courier, array $options)`

Rules (422 with the key shown, translated messages in `lang/bn.json`):
- `courier`: a configured courier → else `courier` "Set up {Courier} first (Settings → Couriers)."
- Store currency must be BDT → `courier` "Couriers collect taka: switch the store currency to taka first."
- Order must be shippable by the **same rules as `OrderDocuments::ship()`** (open, paid or COD, COD confirmed unless `confirmation_override`, not already fully shipped) — call it, don't copy it.
- Phone: Bangladeshi mobile, sent as 11 digits `01XXXXXXXXX` (convert `+8801…`) → else `phone` "A courier needs the customer's Bangladeshi mobile number."
- Shipping address present; sent as one line from `BdAddresses::lines($address, 'en')` (as the CSV does), max 250 / 220 chars.
- `cod_amount`: default `codDueCents()` for COD orders, 0 for prepaid; staff may change it (0 … order total) — integer taka for Pathao (round up), decimals allowed for Steadfast.
- `weight_kg`: default from items (same calculation as the CSV row), clamped 0.5–10 for Pathao.
- `note`: optional ≤ 200, default `courier_note_template`.
- Pathao also: `recipient_city`, `recipient_zone` required, `recipient_area` optional (ids from the location endpoints); `delivery_type`, `item_type` default from settings.

Order of work inside **one DB transaction with the order row locked**: re-check shippable → call the courier (outside the lock is not possible without double booking; keep the lock, the call has a 20 s timeout) → on success `OrderDocuments::ship($order, $admin, $courier, $trackingCode, $note, $notify)` (sets order shipped, history, emails as today) → fill the courier fields on the shipment (`booked_via_api = true`, `delivery_status = booked`, consignment, raw status, cod, fee) → event `booking` → audit `shipment.booked`. Tracking number = Steadfast tracking code, Pathao consignment id. If the courier call fails nothing is saved and the order is unchanged (422 `courier` with the courier's reason).

**Idempotency:** an order with a non-cancelled API-booked shipment can't be booked again (422 `order` "This order is already booked with {Courier} ({consignment})."). Steadfast's `invoice` and Pathao's `merchant_order_id` are our order number, so a retried request after a timeout is refused by the courier as a duplicate — treat "duplicate invoice" answers as an error with that explanation.

### Status updates — `Couriers::apply(Shipment, StatusResult, string $source)`

Idempotent: ignore when `delivery_status` and `courier_status` are unchanged (still bump `last_synced_at`). Otherwise update the shipment, add a `shipment_events` row, and:
- `delivered` → if the order is `shipped`, move it to `delivered` (history note "Delivered — reported by {Courier}", no admin, customer email `OrderStatusMail` as the status change does today). For a COD order with cash still due: record the collection via `OrderDocuments::collect()` with the courier's collected amount (Steadfast `cod_amount` on a delivered webhook, Pathao `collected_amount`; else the booked `cod_amount_cents`) — which invoices and marks paid exactly as a staff collection does. `collect()` / history currently need an `Admin`: make the admin nullable for system actors (history shows "{Courier}" as the actor; audit `actor` "system"), keeping every existing caller unchanged.
- `partly_delivered` → don't change the order; admin notification "Order {n}: {Courier} delivered part of the parcel — check and record the cash" (existing `AdminNotifications`).
- `returned` / `cancelled` (after booking) → don't change the order automatically; admin notification "Order {n}: {Courier} reports the parcel {returned|cancelled}"; the order page shows it.
- `on_hold` → admin notification once per shipment per day.
- Never move an order backwards, never touch cancelled/closed orders, never re-collect.

### Endpoints

Admin (`/api/admin/v1`, token auth like the rest):
- `GET couriers` (`orders.view`) → `{data: [{key, label, configured, mode|null, balance: "৳ …"|null (only when ?balance=1, cached 5 min), webhook_url}], settings: {...}}`
- `PUT couriers/settings` (`settings.edit`; `GET couriers` settings part needs `settings.view` or `orders.view`) → the settings above.
- `GET couriers/pathao/cities`, `…/cities/{city}/zones`, `…/zones/{zone}/areas` (`shipments.create`) → `{data: [{id, name, …}]}`; 422 when Pathao isn't set up; 502 `{message}` when Pathao can't be reached.
- `GET orders/{number}/courier-booking` (`shipments.create`) → the defaults for the dialog: `{courier_default, couriers (configured ones), cod_amount, weight_kg, note, phone, address_line, pathao_match: {city_id?, zone_id?, area_id?}}` — the Pathao match pre-selects by case-insensitive name match of our district → Pathao city and area/thana → zone (null when no match; never guess).
- `POST orders/{number}/courier-booking` (`shipments.create`) `{courier, cod_amount?, weight_kg?, note?, notify_customer?, confirmation_override?, pathao: {city_id, zone_id, area_id?, delivery_type?, item_type?}}` → 201 `{data: AdminShipmentResource}`.
- `POST orders/courier-bookings` (`shipments.create`) `{courier: "steadfast", numbers: [1..50]}` → 200 `{data: {booked: [{number, consignment_id, tracking_code}], failed: [{number, message}]}}` — Steadfast only (Pathao needs a location per order); each order its own transaction; one failure doesn't stop the rest.
- `POST shipments/{shipment_number}/sync` (`shipments.create`) → asks the courier now and applies → `{data: AdminShipmentResource}`; 422 for manual shipments.
- `AdminShipmentResource` / `AdminOrderResource` shipments gain: `courier: {key, label, consignment_id, tracking_code, booked_via_api, courier_status, delivery_status, delivery_status_label, cod_amount, courier_fee, collected, status_updated_at, last_synced_at} | null`, `events: [{delivery_status, label, courier_status, message, source, occurred_at}]`. Orders grid gains a `delivery_status` filter and column value (latest shipment).

Storefront API (`/api/v1`):
- `OrderResource` shipments (customer's own orders and guest order lookup — existing endpoints) gain `delivery_status`, `delivery_status_label` (translated), `tracking_url`, `events: [{delivery_status, label, message, occurred_at}]` — **no** courier fee, collected cash, raw statuses or staff notes.
- Webhooks (no auth middleware, CSRF-free, rate-limited `throttle:120,1`): `POST couriers/steadfast/webhook`, `POST couriers/pathao/webhook`. Wrong/missing secret → 401 (Pathao 401 too), nothing changed. Unknown consignment → 200/202 with a no-op (the courier must not retry forever) and a log line. Compare secrets with `hash_equals`. When the courier's secret isn't configured, the webhook answers 404.

### Command — `buynest:couriers:sync`

Asks the courier for every API-booked shipment whose `delivery_status` is not final (`delivered, returned, cancelled`) and that was booked in the last 30 days, oldest `last_synced_at` first, at most 200 per run, `--dry-run` prints what it would ask. Scheduled every 30 minutes (`withoutOverlapping(20)->onOneServer()`) when `courier_auto_sync` is on. One courier failing doesn't stop the others; prints a summary.

### Tests (feature, `Http::fake()` only)

At least: config "not set up"; Steadfast and Pathao booking success (request body checked: phone format, address, COD amount, invoice/merchant_order_id); courier error → nothing saved; double booking refused; non-BDT refused; unconfirmed COD refused unless override; prepaid order books with COD 0; Pathao token cached and refreshed on 401; location endpoints and name matching; status mapping tables; webhook auth (missing/wrong secret 401, right one applies); webhook idempotency (same payload twice → one event); delivered COD → order delivered, invoiced, paid, collected amount right, customer email; partial/returned/cancelled → notifications, order unchanged; storefront `OrderResource` hides fee/raw status; sync command (dry-run, limits, one courier failing); bulk booking with one failure; permissions (a role without `shipments.create` gets 403); Pint clean.

## 2. Admin app

- **Settings → Couriers** page (in the Settings section of the nav, same permission as other settings): a card per courier — "Set up" / "Not set up" badge, mode (Sandbox / Live), the webhook URL with Copy, Steadfast balance ("Check balance" button), and a short "How to set up" list (put the keys in `backend/.env` — names listed, never values; paste the webhook URL in the courier's panel). Settings form: default courier, auto-sync, default note, Pathao item and delivery type.
- **Order page**: next to "Ship", a **"Book courier"** button (only with `shipments.create`, only when the order can ship and at least one courier is set up; otherwise the button is there but disabled with the reason as text). Dialog: courier choice (radio cards), recipient summary (name, phone, address — read-only, with a link to edit the address), COD amount (pre-filled, "Cash to collect"), weight, note, "Email the customer", and for Pathao three selects City → Zone → Area loaded from the API with the pre-matched values (a clear "Choose the city" message when there's no match). The unconfirmed-COD override reason field as in the Ship dialog. Submit shows the courier's own error text on failure.
- **Shipment card** on the order page: courier label, consignment and tracking code (Copy, tracking page link), a status pill (`delivery_status_label`), COD / fee / collected, last updated, a **"Refresh status"** button, and the event timeline (newest first). Returned / cancelled / partly delivered show a warning callout with what to do next.
- **Orders grid**: "Delivery status" filter and column; bulk action **"Book with Steadfast"** (only when Steadfast is set up) with a result dialog listing booked and failed orders with reasons.
- Shipments page: carrier filter includes the new carriers; delivery status column.
- Manual Ship dialog: the new carriers in the list.
- Unit tests (`Phase18.test.jsx`): dialog validation and submit payload, Pathao cascading selects with pre-match, disabled states, bulk result dialog, settings page (no secret fields rendered), timeline rendering.

## 3. Storefront

- Order detail (account) and guest order lookup: a **delivery tracker** per shipment — steps Booked → Picked up → On the way → Out for delivery → Delivered (current highlighted; returned / cancelled / on hold shown as a clear notice, not a step), courier name, tracking code with Copy and "Track on {Courier}" link (external, `rel="noopener"`), and the event list (date/time localised, Bangla digits in Bangla). Manual shipments (`shipped`) look as today plus the carrier's tracking link.
- Order list: the latest delivery status as a small label.
- All texts in `en` and `bn` locale files. Accessible: the tracker is an ordered list with `aria-current="step"`; colour is never the only signal.
- BFF (`frontend/server`): pass the new shipment fields through any whitelists (remember M1 in phase 17: `has_sales` was dropped by a whitelist); proxy tests for the new fields. Webhooks go straight to Laravel, not through the BFF — document the URLs as the API's.
- Unit tests for the tracker (each status, Bangla digits, manual shipment, returned notice).

## 4. Browser suite `e2e/courier.mjs` (lead)

Local stand-in servers for Steadfast and Pathao on 127.0.0.1 (record requests, answer like the contract above), a second API process with the courier env pointing at them (pattern: `e2e/taka.mjs`). Covers: settings page shows set up; book a COD order with Steadfast from the order page; Pathao booking with city/zone/area; courier error shown, order unchanged; webhook delivered → order delivered and paid, customer sees "Delivered" in English and Bangla; wrong webhook secret refused; Refresh status; bulk booking; axe and 390px on the dialog and tracker; cleanup. Added to `run-all.mjs` after `marketplace`.

## 5. Docs

`docs/BANGLADESH.md` (couriers section: set-up steps, env names, webhook URLs, what happens on each status, **launch step: verify each courier with sandbox credentials**), README row B20, SQA section, LEARNING_LOG, `docs/I18N.md` new strings.

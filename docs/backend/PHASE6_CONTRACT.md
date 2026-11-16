# Backend phase 6 contract: Magento-style customers and sales

**Status: built (backend, 2026-11-16).** Choices the implementation made where this page left something open are listed in the implementation notes at the end.

Builds on phases 1 to 5 and keeps their conventions (`snake_case`, money as 2-decimal strings, `{ data }`, Laravel 422 errors, `can.admin:<key>` on every admin route, an audit entry for every admin change, customer emails through the existing mailer and dev inbox). Modeled on Magento's **Customers → All customers / Customer groups**, the customer **address book**, **Sales → Orders → Create new order**, **Sales → Shipments**, **Returns (RMA)**, and the order grid's **mass actions**.

Already built in earlier phases and only extended here: order status changes, notes and "notify customer" (phase 2/3), invoices, shipments and credit memos created from an order (phase 3).

## 1. Customer address book

- `customer_addresses`: `id, customer_id, first_name, last_name, phone, company null`, and the same address fields orders already store (use the exact field names of `orders.shipping_address`), `is_default_shipping`, `is_default_billing`, `timestamps`. At most 20 per customer; at most one default of each kind (setting one clears the other).
- Storefront (customer token): `GET/POST /api/v1/me/addresses`, `PATCH/DELETE /api/v1/me/addresses/{id}` (another customer's id: 404). Country must be in the store's `allowed_countries`.
- Checkout (signed in): pre-fills the default shipping and billing addresses and offers the saved ones; a "Save this address to my address book" checkbox (`save_address: true` on `POST /orders`) adds it after the order is placed (skipped when the book is full or the address already exists).

## 2. Customer groups

- `customer_groups`: `id, name (unique), code (unique, a-z0-9_), discount_percent (0 to 90, 2 decimals), is_system bool, timestamps`. Seeded: **General** (system, 0%, the default for new sign-ups), **Wholesale** (10%), **VIP** (5%).
- `customers` gains `group_id` (existing customers → General). Guests are priced as General.
- Pricing: a group's `discount_percent` applies to each line's sale price (after the product's own discount, before coupons) in cart validation, checkout, and admin-created orders. Orders store it: `order_items.group_discount_percent`, and `orders.customer_group` (name at the time of the order). Refund math uses the stored line amounts, so it doesn't change.
- `GET /api/v1/me` adds `group: { name, discount_percent }` so the storefront can say "Wholesale price: 10% off at checkout".
- Admin (`customer_groups.manage` to change, `customers.view` to read): `GET/POST /customer-groups`, `PATCH/DELETE /customer-groups/{id}` (system group: can change discount, not delete; a group in use: 422 naming how many customers).

## 3. Customer management in the admin

- `GET /customers/{id}` grows into a full profile: account fields, group, status, `email_verified`, `last_login_at`, addresses, `orders_count`, `lifetime_spent` (non-cancelled orders minus credit memos), the last 10 orders, reviews count, and admin notes.
- `PATCH /customers/{id}` (`customers.edit`) `{ first_name, last_name, email, phone, group_id, is_active }`. Changing the email (unique among customers) marks it unverified and signs the customer out everywhere; on their next sign-in the existing "verify your email" flow sends them a code.
- `POST /customers` (`customers.create`) `{ first_name, last_name, email, phone, group_id }` creates an account with no usable password and emails a "Set your password" message with a reset code (the existing forgot-password code flow). Completing a password reset with a code marks the email as verified.
- `POST /customers/{id}/password-reset` (`customers.edit`) sends that same email. Admins never see or set customer passwords.
- Admin addresses for a customer: `GET/POST /customers/{id}/addresses`, `PATCH/DELETE /customers/{id}/addresses/{addressId}` (`customers.edit`).
- Admin notes: `customer_notes`: `id, customer_id, admin_id, body (max 2000), created_at`. `GET/POST /customers/{id}/notes`, never shown to the customer.
- `DELETE /customers/{id}` (`customers.delete`): deletes the account, its addresses, notes, and tokens; keeps their orders (with `customer_id` null) and reviews (author name kept, `customer_id` null) for the accounts. Refused (422) while the customer has an order in `pending`/`processing`/`shipped`.
- `GET /customers/export.csv` (`customers.view`) with the list's filters (CSV injection guard).
- List filters gain `group_id`, `status`, `verified`, `created_from`/`created_to`.

## 4. Admin-created orders (phone orders)

- `POST /orders/quote` (`orders.create`) and `POST /orders` (`orders.create`) on `/api/admin/v1`, same body:
  `{ customer_id | guest: { email, phone, first_name, last_name }, items: [{ product_id, variant_id?, quantity }], shipping_address, billing_address | same_as_shipping, shipping_method, payment_method, coupon_code?, note?, notify_customer (default true) }`.
- Uses the same checkout service as the storefront: server prices, group discount, coupons, tax, stock checks and row locks, enabled shipping methods. The settings' allowed payment methods apply, plus `bank_transfer` and `cash` which only admins may choose.
- `quote` answers the totals (no order, no stock change) like cart validation; `POST /orders` creates the order with `source: "admin"` and `created_by_admin_id`, and emails the usual confirmation when `notify_customer` is true.
- `orders.source` (`storefront|admin`) is shown in the admin order grid and detail.

## 5. Shipments list

- `GET /shipments?carrier&from&to&search&page` (`orders.view`) — search matches the shipment number, tracking number, or order number. `GET /shipments/{number}` with its order summary and items.
- Printable packing slip: `GET /orders/{number}/packing-slip` returns the data for an admin print page (items, quantities, variant labels, ship-to address; no prices).

## 6. Returns (RMA)

- Settings (Settings → Returns): `returns_enabled` (default true), `return_window_days` (default 30, counted from the order's `delivered` date, or from its last shipment when there's no delivered date), `return_reasons` (default: Damaged, Wrong item, Not as described, No longer needed, Other).
- `returns`: `id, number (RMA-100000+id), order_id, customer_id null, status, reason, comment null, admin_note null, resolution null (refund|replace|store_credit — store credit is out of scope, so only refund|replace), timestamps`. `return_items`: `id, return_id, order_item_id, quantity, condition null (unopened|opened|damaged)`.
- Statuses: `requested → approved | rejected`, `approved → received`, `received → refunded | closed`. Any other move: 422.
- Storefront (customer token): `POST /api/v1/orders/{number}/returns` `{ items: [{ order_item_id, quantity }], reason, comment? }` — only for that customer's own orders, only when returns are enabled, the order was shipped or delivered and is inside the window, and the quantity ≤ shipped quantity minus quantity already in open or completed returns and already refunded. `GET /api/v1/returns`, `GET /api/v1/returns/{number}` (own only).
- Admin: `GET /returns?status&search&page` and `GET /returns/{number}` (`returns.view`); `PATCH /returns/{number}` `{ status, admin_note?, notify_customer }` (`returns.manage`). `received` takes `items: [{ return_item_id, condition }]` and `restock: bool`. `refunded` is set automatically when a credit memo is created with `return_number` (the credit memo endpoint gains an optional `return_number`; the admin's "Refund this return" button opens the existing credit memo dialog pre-filled with the returned items and quantities, and restocking is not done twice).
- Admins can also create a return for a customer: `POST /orders/{number}/returns` (`returns.manage`), same rules except the window can be overridden.
- Every status change emails the customer (dev inbox in development) and adds an order status-history note.

## 7. Order grid mass actions

- `POST /orders/bulk` `{ numbers: [1..100], action }` with `action`:
  - `invoice` (`invoices.create`): invoices unpaid orders that allow it
  - `ship` (`shipments.create`) `{ carrier, notify_customer }`: ships every remaining item with no tracking number
  - `cancel` (`orders.edit`): cancels orders that can be cancelled
- Each order is handled on its own (one failing order doesn't stop the others): answer `{ data: { done: [numbers], skipped: [{ number, reason }] } }`.
- Printing: the admin opens a print page for the selected orders (invoices or packing slips) built from the existing invoice and packing-slip data; no new endpoint.
- `GET /orders/export.csv` (`orders.view`) with the grid's filters.

## 8. Permissions and roles

New keys: `customers.create`, `customers.delete`, `customer_groups.manage` (Customers group), `orders.create`, `returns.view`, `returns.manage` (Sales group). Starter roles: **Sales staff** gets `orders.create`, `returns.view`, `returns.manage`, `customers.create`; **Viewer** gets `returns.view`. A migration gives existing roles in the database their new keys.

## Browser-facing routes (sign-in service)

- Store: `/api/shop/me/addresses…`, `/api/shop/orders/{number}/returns`, `/api/shop/returns…`, and `save_address` passed through on order placement.
- Admin: `/api/admin/customer-groups…`, `/api/admin/customers…` (create, addresses, notes, password reset, delete, export CSV), `/api/admin/orders/quote`, `POST /api/admin/orders`, `/api/admin/orders/bulk`, `/api/admin/orders/export.csv`, `/api/admin/orders/{number}/packing-slip`, `/api/admin/shipments…`, `/api/admin/returns…`, `/api/admin/orders/{number}/returns`.

## UI

- **Storefront** (real mode)
  - Account → Address book (add, edit, delete, set defaults).
  - Checkout uses saved addresses for signed-in customers, with the "save to address book" option.
  - Account → order detail gets a "Request a return" form (item and quantity pickers, reason, comment), and Account → Returns has a list and detail with status.
  - Signed-in group members see their group discount in cart and checkout.
- **Admin**
  - **Customer detail page** with tabs:
    - Account (edit)
    - Addresses
    - Orders
    - Notes
    - Actions: send password reset, block/unblock, delete with confirmation.
  - "Add customer" form, Customer groups page, and customer list filters and CSV export.
  - **Create order page:**
    - Pick a customer (search) or enter a guest.
    - Add products by search, with variant pickers.
    - Addresses (customer's saved ones offered), shipping, payment, coupon.
    - Live totals from `quote`, then place the order.
  - **Shipments page** and packing-slip print page.
  - **Returns pages:** list, detail with the status actions, and "Refund this return" opening the credit memo dialog.
  - **Order grid:** checkboxes with the bulk action bar (invoice, ship, cancel, print invoices, print packing slips), a source column, and CSV export.

## Tests

Backend feature tests for every rule (address ownership and limits, default flags, group pricing in cart, checkout, and admin orders, group deletion guard, email change signs out and unverifies, admin-created customer's set-password flow, customer delete guard and what's kept, admin order quote equals created order and locks stock, admin-only payment methods, returns window and quantity limits, status transitions, refund via return without double restock, bulk partial success, CSV injection, permissions on every new route). Storefront and admin unit tests for the new UI, and a new browser suite `e2e/customers.mjs`.

## Implementation notes (backend, 2026-11-16)

Where the contract left something open, the Laravel side chose the following. Paths are under `/api/admin/v1` (admin) or `/api/v1` (store). Money is a `"0.00"` string, dates ISO 8601 UTC (`2026-11-16T10:00:00Z`), lists are Laravel's paginated `{ data, links, meta }` unless shown otherwise.

**Address book**
- Address item (store and admin): `{ id, first_name, last_name, company, phone, line1, line2, city, state, postal_code, country, is_default_shipping, is_default_billing, created_at, updated_at }`. `phone` is E.164 (`+15550100100`, normalized like sign-up). The order address fields are exactly `first_name, last_name, line1, line2, city, state, postal_code, country`.
- `GET /me/addresses` → `{ data: [items] }` (not paginated; default shipping first, then default billing, then oldest first). `POST` → 201 `{ data: item }`; `PATCH` (only the fields sent) → `{ data: item }`; `DELETE` → 204. Another customer's id → 404 `{ message: "Address not found." }`.
- Required on POST: `first_name, last_name, phone, line1, city, postal_code, country`; optional `company, line2, state, is_default_shipping, is_default_billing`. Country must be in `allowed_countries` (422 `country`: "We don't deliver to that country yet.").
- The **first** address becomes both defaults. Setting a default clears it on the others. Deleting a default leaves none (nothing is promoted).
- 21st address → 422 `address`: "An address book can have at most 20 addresses. Delete one first."
- Checkout: `POST /api/v1/orders` accepts `save_address: true` (ignored for guests). After the order is placed the **shipping** address is added with the order's phone, skipped silently when the book is full or an address with the same 8 fields (ignoring case and spaces) exists. The order answer doesn't change.
- Admin: `GET/POST /customers/{id}/addresses`, `PATCH/DELETE /customers/{id}/addresses/{address}` — same shapes and rules (`customers.view` to read, `customers.edit` to change). Audit: `customer.address_added`, `customer.address_updated`, `customer.address_deleted` (subject `customer`).

**Customer groups and pricing**
- Group item (admin): `{ id, name, code, discount_percent: "10.00", is_system, is_default, customers_count, created_at, updated_at }`. `GET /customer-groups` → `{ data: [items] }` (not paginated; General first, then by name).
- `POST /customer-groups` `{ name, code?, discount_percent }` → 201 (`code` made from the name when left out: lower-case, `[^a-z0-9]` → `_`). `PATCH` any of them. `DELETE` → 204. Errors: `name`/`code` unique, `code` regex `^[a-z0-9_]+$`, `discount_percent` 0–90 with up to 2 decimals. System group (General): name and discount can change, its code can't (422 `code`), can't be deleted (422 `group`). In use → 422 `group`: "3 customers are in the Wholesale group. Move them all to another group first."
- Audit: `customer_group.created`, `customer_group.updated`, `customer_group.deleted`.
- New customers (sign-up and admin-created) join General; guests are priced as General (whatever General's discount is).
- Math: per unit, `sale_price = round(base_sale_price × (1 − group% / 100))` in cents, halves up; `line_total = sale_price × quantity`. Coupons then apply to the subtotal as before.
- `POST /cart/validate` (and the admin `orders/quote`) lines gain `group_discount_percent` (number, e.g. `10`) and `base_sale_price` (the product/variant sale price before the group discount); **`sale_price` and `line_total` are now after the group discount**. `totals` gains `group_discount` (what the group took off; already inside `subtotal`, so don't subtract it again). The answer gains `customer_group: { name, discount_percent } | null` (guests: General).
- Order items gain `group_discount_percent` (number) and their `sale_price` is after it; orders gain `customer_group` (the group's name at the time; `null` for orders before phase 6). Refund math is unchanged (it uses the stored line totals).
- `GET /me` (and the `customer` in sign-in answers) adds `group: { name, discount_percent }`.

**Customer management (admin)**
- List item (`GET /customers`): `{ id, first_name, last_name, email, phone, email_verified_at, email_verified, is_active, status ("active"|"unverified"|"blocked"; blocked wins), group: { id, name, code, discount_percent } | null, orders_count, created_by_admin (bool), last_login_at, created_at }`.
- List filters: `search`, `status` = `active` | `blocked` | `verified` | `unverified` (`verified` = verified and not blocked, kept from phase 1), `verified` = `1|0` (email verified or not, any status), `group_id`, `created_from`, `created_to` (`YYYY-MM-DD`, inclusive), `page`, `per_page`.
- `GET /customers/export.csv` (same filters, all matching rows, newest first) → `customers-YYYY-MM-DD.csv` with columns `id,first_name,last_name,email,phone,group,status,email_verified (yes|no),orders_count,lifetime_spent,last_login_at,created_at`; cells starting with `= + - @` (tab, CR) get a `'` — that includes phone numbers (`'+15550100100`), as in the phase 4/5 exports.
- Customer detail (`GET /customers/{id}`, and the `data` of POST, PATCH): the list item plus `{ addresses: [address items], orders_count, lifetime_spent: "123.45", recent_orders: [{ number, status, payment_status, source, item_count, total, placed_at }] (last 10, newest first), reviews_count, notes: [note items, newest first] }`. `lifetime_spent` = Σ grand_total of the customer's orders that aren't cancelled − Σ their credit memos. For the full order list use `GET /orders?customer_id={id}`.
- `PATCH /customers/{id}` any of `{ first_name, last_name, email, phone, group_id, is_active }`. Email: lower-cased, unique among customers (422 `email`: "Another customer already uses this email."). A new email sets `email_verified: false` and revokes every token; their next sign-in answers 403 `email_unverified` and emails a code (existing flow). `is_active: false` also revokes every token. `group_id: null` is ignored. Audit: `customer.blocked` / `customer.unblocked` when only `is_active` changed, otherwise `customer.updated` with the changed fields.
- `POST /customers` `{ first_name, last_name, email, phone, group_id? }` (all but `group_id` required; `is_active` not accepted) → 201 detail. The account gets a random password nobody knows and `created_by_admin: true`; it is never pruned as an abandoned sign-up. A "Set your BuyNest password" email goes out with a 6-digit `reset_password` code: the customer completes it with the existing `POST /auth/reset-password { email, code, password, password_confirmation }` (the storefront's forgot-password page works as is), which also marks the email verified. Codes expire after 10 minutes as before; "Forgot password?" sends a new one. Audit `customer.created`.
- `POST /customers/{id}/password-reset` → 200 `{ message, data: { email, resend_in } }` and the same email. Blocked customer → 422 `customer`. Sent less than a minute ago → **429** `{ message, code: "too_soon" }` with `Retry-After`. Audit `customer.password_reset_sent`.
- Note item: `{ id, body, admin: { id, name } | null, created_at }`. `GET /customers/{id}/notes` → `{ data: [items] }` newest first (`customers.view`); `POST { body (max 2000) }` → 201 `{ data: item }` (`customers.edit`). Notes can't be edited or deleted. Audit `customer.note_added`.
- `DELETE /customers/{id}` → 204. Refused with 422 `customer` ("This customer has 2 open orders (pending payment, processing, or shipped). …") while any order is `pending_payment`, `processing`, or `shipped`. Deletes addresses, notes, tokens, and one-time codes; orders, reviews (author name kept), coupon uses, and returns stay with `customer_id` null. Audit `customer.deleted`.
- Unknown customer id → 404 `{ message: "Customer not found." }`.

**Admin-created orders**
- Body (both endpoints): `{ customer_id | guest: { email, phone, first_name, last_name }, items: [{ product_id, variant_id?, quantity }], shipping_address: { first_name, last_name, line1, line2?, city, state?, postal_code, country }, billing_address? | same_as_shipping: true, shipping_method, payment_method, coupon_code?, note?, notify_customer? (default true), expected_total? }`. Billing defaults to the shipping address when `same_as_shipping` is true or `billing_address` is missing/null. `customer_id` and `guest` are mutually exclusive (422 `customer_id`). A blocked customer → 422 `customer_id`. The guest's `first_name`/`last_name` are only for the form (the order stores the addresses); email and phone come from the customer account when `customer_id` is used.
- `POST /orders/quote` (`orders.create`): only `items` is required (so totals can update live); without a shipping method the store default is used; tax uses `shipping_address.country` when given. Answer 200 = exactly the `cart/validate` `data` (lines, problems, coupon, coupon_error, shipping_options, totals, tax_estimated, customer_group) plus `payment_methods: ["card","paypal","cod","bank_transfer","cash"]` (the store's enabled methods + the two admin-only ones). Nothing is saved, no stock is taken. Problems and coupon errors are reported in the 200 answer like the cart.
- `POST /orders` (`orders.create`) → 201 `{ data: admin order }` with `source: "admin"`. Same checkout service (row locks, stock, coupon use counted). Errors exactly like the storefront: 422 with `problems` (stock, variant), 422 `coupon_code`, 409 when `expected_total` differs (with the fresh quote in `data`). `payment_method` must be one of the store's enabled methods or `bank_transfer` / `cash` (422 `payment_method`). Guest checkout being off doesn't apply to staff.
- `bank_transfer` starts `pending_payment` (like card: invoice it when the money arrives). `cash` starts `processing` and may ship before the invoice (like `cod`).
- `note` is a staff-only history entry (`customer_notified: false`) after "Order placed."; the "Order placed." entry carries the admin. `notify_customer: false` skips the confirmation email. Audit `order.created`.
- Admin order resource (list and detail) gains `source` ("storefront"|"admin") and `created_by_admin: { id, name } | null`; every order resource gains `customer_group`. The order grid gains filters `source` and `customer_id`.
- Settings `GET /settings` `meta` gains `admin_payment_methods: [{ id: "bank_transfer", label: "Bank transfer" }, { id: "cash", label: "Cash" }]`.

**Shipments list and packing slip**
- `GET /shipments?carrier&from&to&search&page&per_page` (`orders.view`; newest first; `from`/`to` = shipment date `YYYY-MM-DD` inclusive; search = shipment number, tracking number, or order number). Item: `{ number, order_number, carrier, carrier_label, tracking_number, tracking_url, created_at, admin_name, note, item_count, order: { number, status, payment_status, email, customer_name, ship_to ("Berlin, Germany"), placed_at } }`.
- `GET /shipments/{number}` → `{ data: item + order.{ shipping_method: { id, label }, shipping_address, phone } + items: [{ order_item_id, sku, name, variant_label, thumbnail_url, quantity }] }`. 404 `Shipment not found.` One shipment still ships every item.
- `GET /orders/{number}/packing-slip` (`orders.view`) → `{ data: { order_number, placed_at, status, email, phone, shipping_method: { id, label }, ship_to: address, items: [{ order_item_id, sku, name, variant_label, quantity }], item_count, shipments: [{ number, carrier, carrier_label, tracking_number, created_at }], store: { name, address, support_email, support_phone } } }`. No prices.

**Returns (RMA)**
- Settings group `returns`: `PATCH /settings { returns: { returns_enabled: bool, return_window_days: 1–365, return_reasons: [1–20 distinct strings, max 60 chars] } }`. Defaults `true`, `30`, `["Damaged","Wrong item","Not as described","No longer needed","Other"]`. `GET /api/v1/store` adds `returns_enabled, return_window_days, return_reasons`.
- Window: from the first `delivered` history entry, or the last shipment's date when there is none. Eligible statuses: `shipped`, `delivered` (with a shipment).
- Returnable per line: ordered quantity (once shipped) − units in returns that aren't `rejected` − units refunded by credit memos **not** linked to a return.
- Store order detail (`GET /api/v1/orders/{number}`) and admin order detail (`GET /orders/{number}`) gain `returns: [{ number, status, items_count, created_at }]` and `return_eligibility: { eligible, code (null|"returns_disabled"|"not_shipped"|"window_closed"|"nothing_left"), message, deadline (ISO|null), window_days, reasons: [..], items: [{ order_item_id, name, variant_label, sku, thumbnail_url, ordered, returnable }] }` (the same in the admin; staff can override only the window, when creating a return). Only order detail answers have these two keys (not lists, the guest lookup, or the answer of `POST /orders`).
- `POST /api/v1/orders/{number}/returns` `{ items: [{ order_item_id, quantity ≥ 1 }], reason (one of return_reasons), comment? (max 1000) }` → 201 `{ data: customer return detail }`. Someone else's order → 404. Not eligible → 422 `order` (the eligibility message). Too many → 422 `items.N.quantity` ("Only 1 of X can be returned."). Unknown line → `items.N.order_item_id`. Reason not in the list → 422 `reason`.
- Return list item (admin): `{ number, order_number, status, reason, resolution, items_count, created_at, updated_at, email, customer: { id, name, email } | null, created_by_admin: { id, name } | null }`. Customer list item: the same without `email`, `customer`, `created_by_admin`.
- Return detail = list item + `{ comment, admin_note, restocked, items: [{ id (return_item_id), order_item_id, product_id, variant_id, sku, name, variant_label, thumbnail_url, quantity, condition }], order: { number, status, payment_status, placed_at }, credit_memo: { number, total, created_at } | null, allowed_transitions: ["approved","rejected"] (admin; never "refunded"), can_refund (admin: status is received) }`. Customers see `admin_note` only if the change that set it notified them, `allowed_transitions: []`, `can_refund: false`.
- `GET /api/v1/returns` (paginated, newest first, `per_page` ≤ 50), `GET /api/v1/returns/{number}` (own only, else 404 `Return not found.`).
- Admin `GET /returns?status&search&page&per_page` (`returns.view`; search = RMA number, order number, email, customer name) adds `meta.counts: { requested, approved, rejected, received, refunded, closed }` (all returns). `GET /returns/{number}` → `{ data: detail }`.
- `PATCH /returns/{number}` (`returns.manage`) `{ status, admin_note? (max 1000), resolution? ("refund"|"replace"), notify_customer? (default true), items?: [{ return_item_id, condition: "unopened"|"opened"|"damaged" }], restock?: bool }` → `{ data: detail }`. `items`/`restock` are used when moving to `received`; `restock: true` puts the returned units back in stock (variants too) and sets `restocked: true`. Any move not in the table → 422 `status` naming the allowed ones. `status: "refunded"` by PATCH → 422 `status` (use the credit memo). A note sent with a change replaces `admin_note`.
- `POST /orders/{number}/returns` (`returns.manage`) — the customer body plus `override_window?: bool`, `notify_customer?` → 201 detail. Overriding skips only the window (returns must still be enabled, the order shipped, quantities available).
- Refund: `POST /orders/{number}/credit-memos` accepts `return_number`. The return must belong to the order and be `received` (else 422 `return_number`). The memo is linked (`return_number` in the credit memo resource), the return becomes `refunded` (resolution `refund`) in the same transaction, and if the return was already restocked on receipt the memo's `restock` is ignored (`restocked: false`), so nothing is restocked twice. Quantities in the memo are not forced to match the return (the dialog pre-fills them).
- Each creation and status change adds an order history note ("Return RMA-100001 approved.", `customer_notified` = notify) and, with notify, sends the return status email (subjects: "We received your return request", "Your return was approved", "Your return request was declined", "We received your returned items", "Your return was refunded", "Your return is complete", each followed by "(RMA-…)"; dev inbox in development). It goes to the order's email. The customer's own request always emails.
- Return statuses whose items count against what's returnable: everything but `rejected`. A fully refunded (`closed`) order answers `nothing_left`; a cancelled or unshipped one `not_shipped`.
- Audit actions: `return.created` (admin-created only), `return.approved`, `return.rejected`, `return.received`, `return.closed`, `return.refunded` (subject `return`).

**Order grid mass actions and export**
- `POST /orders/bulk` `{ numbers: [1–100 order numbers], action: "invoice"|"ship"|"cancel", carrier? (required for ship: dhl|fedex|ups|usps|other), notify_customer? (default true) }` → 200 `{ data: { done: ["BN-100001", …], skipped: [{ number, reason }] } }`. The route needs `orders.view`; the action additionally needs `invoices.create` / `shipments.create` / `orders.edit` (same 403 `permission_denied` body naming that key). Each order runs in its own transaction with its row locked; reasons are the single-order messages ("This order has already been invoiced.", "Invoice this order before shipping it: it hasn't been paid yet.", "Order not found.", …). Emails per done order when notified (invoice, shipment, cancellation).
- `GET /orders/export.csv` (`orders.view`, the grid's filters `search, status, payment_status, source, customer_id`) → `orders-YYYY-MM-DD.csv` with `number,placed_at,status,payment_status,source,customer_name,email,phone,customer_group,items,subtotal,discount,shipping,tax,total,paid,refunded,payment_method,shipping_method,coupon_code,ship_to_city,ship_to_country` (CSV injection guard).

**Permissions**
- New keys: `customers.create`, `customers.delete`, `customer_groups.manage` (Customers), `orders.create`, `returns.view`, `returns.manage` (Sales). `customers.edit` now covers editing the account, addresses, notes, and sending password resets.
- Route permissions: customers list/detail/export/addresses GET/notes GET and `GET /customer-groups` → `customers.view`; PATCH customer, password reset, address changes, POST notes → `customers.edit`; `POST /customers` → `customers.create`; `DELETE /customers/{id}` → `customers.delete`; group changes → `customer_groups.manage`; `orders/quote`, `POST /orders` → `orders.create`; shipments list/detail, packing slip, orders export, bulk → `orders.view` (+ action key); returns GET → `returns.view`; PATCH returns and `POST /orders/{number}/returns` → `returns.manage`.
- Migration `2026_11_16_000800_grant_phase6_permissions` gives existing "Sales staff" `orders.create, returns.view, returns.manage, customers.create` and "Viewer" `returns.view`.

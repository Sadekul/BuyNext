# Backend phase 6 contract: Magento-style customers and sales

**Status: planned (2026-11-16).** Starts after phase 5 is built and verified.

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

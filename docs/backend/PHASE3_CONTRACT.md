# Backend phase 3 contract: invoices, shipments, refunds, coupons

Builds on [PHASE2_CONTRACT.md](PHASE2_CONTRACT.md) (orders, statuses, pricing in integer cents) and keeps all its conventions: `snake_case`, money as 2-decimal strings, `{ data }`, Laravel 422 errors, admin token on `/api/admin/v1`. Modeled on Magento's order workflow: **Invoice** (records payment), **Ship** (tracking), **Credit memo** (refund).

## What changes for orders

The phase 2 shortcuts are replaced by documents:

| Phase 2 | Phase 3 |
| --- | --- |
| PATCH `payment_status: "paid"` | **Create invoice** (records the payment; pending_payment → processing) |
| PATCH `status: "shipped"` | **Create shipment** (carrier + tracking number; → shipped; email with tracking) |
| (none) | **Create credit memo** (refund some or all items, shipping, an adjustment; optional restock) |

PATCH `/orders/{number}` keeps working for `delivered`, `cancelled`, and notes, and still accepts `payment_status: "paid"` and `status: "shipped"` as shortcuts that create a full invoice / a shipment without tracking (so phase 2 clients keep working).

New order fields: `payment_status` gains `partially_refunded` and `refunded`; `status` gains `closed` (fully refunded; final). Transitions: `delivered → closed` and `processing|shipped → closed` only through a full credit memo. Cancel is refused once an invoice exists (refund instead), with a 422 message saying so.

Order totals gain `refunded` (sum of credit memos) and `paid` (sum of invoices).

## Invoices

- Table `invoices`: `id, number (INV-100001 = 100000 + id), order_id, amount (decimal), admin_id, note null, created_at`. One invoice per order in phase 3 (the full grand total); a second → 422.
- `POST /api/admin/v1/orders/{number}/invoices` `{ note?, notify_customer? }` → 201 `{ data: InvoiceResource }`. Sets `payment_status=paid`; moves `pending_payment → processing`; history entry "Invoice INV-… created; payment of $X recorded."; emails the customer when notified.
- Refused (422) for cancelled or already-invoiced orders.
- `GET /api/admin/v1/invoices?search&page` (list across orders), `GET /api/admin/v1/invoices/{number}`.
- **InvoiceResource**: `{ number, order_number, amount, created_at, admin_name, note, billing_address, items (the order's item snapshots), totals (the order's totals) }`.
- Customers: `GET /api/v1/orders/{number}` includes `invoices: [{ number, amount, created_at }]`; `GET /api/v1/orders/{number}/invoices/{invoice}` returns the InvoiceResource (own orders only). The storefront shows a **printable invoice page** (print stylesheet; no PDF library needed).

## Shipments

- Table `shipments`: `id, number (SHP-100001), order_id, carrier (dhl|fedex|ups|usps|other), tracking_number null, admin_id, note null, created_at`. One shipment per order (all items) in phase 3.
- `POST /api/admin/v1/orders/{number}/shipments` `{ carrier, tracking_number?, note?, notify_customer? }` → 201. Allowed from `processing` only (a `pending_payment` order must be invoiced first, except `cod`, which may ship unpaid). Sets `status=shipped`; history entry; email with carrier and tracking number (and a tracking link for the known carriers).
- **ShipmentResource**: `{ number, order_number, carrier, carrier_label, tracking_number, tracking_url null, created_at, admin_name, note }`. Order resources (customer, guest lookup, admin) include `shipments: [ShipmentResource]`.
- Tracking URLs: DHL `https://www.dhl.com/en/express/tracking.html?AWB={n}`, FedEx `https://www.fedex.com/fedextrack/?trknbr={n}`, UPS `https://www.ups.com/track?tracknum={n}`, USPS `https://tools.usps.com/go/TrackConfirmAction?tLabels={n}`.

## Credit memos (refunds)

- Tables `credit_memos`: `id, number (CM-100001), order_id, subtotal, shipping_refund, adjustment (may be negative: a fee kept), total, restocked bool, admin_id, note null, created_at`; `credit_memo_items`: `id, credit_memo_id, order_item_id, quantity, amount`.
- `POST /api/admin/v1/orders/{number}/credit-memos` `{ items: [{ order_item_id, quantity }], shipping_refund: "4.99", adjustment: "0.00", restock: true, note?, notify_customer? }` → 201.
  - Only for orders with `payment_status` paid or partially_refunded.
  - Per item: quantity ≤ ordered − already refunded. Item amount = the item's share of what the customer actually paid: `sale_price × qty`, minus that line's share of the order coupon discount (proportional to line totals, rounded to the cent; the last refundable unit takes the remainder so a full refund equals exactly what was paid).
  - `shipping_refund` ≤ shipping paid − shipping already refunded. `total = Σ items + shipping_refund + adjustment`, must be > 0 and ≤ paid − already refunded.
  - `restock: true` returns the quantities to stock (only for products that still exist).
  - Sets `payment_status` `partially_refunded` or `refunded`; a full refund sets `status=closed`. History entry; email to the customer.
- `GET /api/admin/v1/orders/{number}/refundable` → `{ data: { items: [{ order_item_id, name, sku, ordered, refunded, refundable, unit_refund }], shipping_refundable, max_total } }` so the admin form can show limits.
- `GET /api/admin/v1/credit-memos?search&page`, `GET /api/admin/v1/credit-memos/{number}`.
- **CreditMemoResource**: `{ number, order_number, items: [{ name, sku, quantity, amount }], subtotal, shipping_refund, adjustment, total, restocked, created_at, admin_name, note }`. Customer order resources include `credit_memos: [{ number, total, created_at }]`.
- Payment providers are still not connected: the memo records that money was returned (the admin returns it by the original method). The UI says so.

## Coupons in the database (Magento "Cart Price Rules", simplified)

- Table `coupons`: `id, code (unique, stored upper-case), description, type (percent|fixed|free_shipping), value (decimal; percent 1–100, fixed > 0, free_shipping 0), min_subtotal null, starts_at null, ends_at null, usage_limit null (total uses), usage_limit_per_customer null, times_used int default 0, is_active bool, timestamps`; `coupon_redemptions`: `id, coupon_id, order_id, customer_id null, email, created_at`.
- Migration seeds `NEST10` and `SAVE20` with today's rules; `config('buynest.store.coupons')` is removed and the pricing service reads the database.
- Validity (in this order, first failure wins, messages shown as-is): unknown or inactive → "This code is not valid."; not started / ended → "This code has expired." (or "This code isn't active yet."); `min_subtotal` → "Spend at least $X to use this code."; total usage reached → "This code has been fully used."; per-customer limit (by customer id, or by email for guests) → "You've already used this code."
- `free_shipping`: makes the chosen shipping method free (all methods), no merchandise discount.
- Usage is counted when an order is placed (in the checkout transaction, with a row lock on the coupon), and released when an order is cancelled.
- cart/validate takes an optional `email` (guests) so per-customer limits can be checked before checkout; signed-in customers are identified by their token (optional Bearer on cart/validate, like orders).
- Admin: `GET /api/admin/v1/coupons?search&status=active|inactive|expired&page`, `POST`, `GET /{id}`, `PATCH /{id}`, `DELETE /{id}` (soft-disable when it has redemptions: is_active=false, 200 with the coupon; hard delete otherwise, 204). **CouponResource**: all columns plus `status` (active, inactive, scheduled, expired, used_up) and `times_used`.
- Public: `GET /api/v1/coupons/{code}` is NOT provided (codes aren't listed or probed; cart/validate is the only check, and it's rate limited).

## Emails
New: invoice ("Payment received"), shipment ("Your order is on its way", with tracking), refund ("Refund for order BN-…"). Same Blade style as phase 2; all appear in `/dev/mailbox`.

## Browser-facing routes (sign-in service)
- Admin: `/api/admin/orders/{number}/invoices|shipments|credit-memos|refundable` (POST/GET as above), `/api/admin/invoices…`, `/api/admin/credit-memos…`, `/api/admin/coupons…`, mapped to camelCase like the other admin routes.
- Store: `/api/shop/orders/{number}/invoices/{invoice}` (customer session); order resources gain `invoices`, `shipments`, `creditMemos`; `/api/shop/cart/validate` passes the customer token when present and the guest `email`.

## UI
- Admin order page: buttons "Invoice", "Ship" (carrier select + tracking number), "Refund" (form with per-item quantities, shipping refund, adjustment, restock checkbox, live total from `/refundable`), plus lists of the order's documents. New sections: Sales → Invoices, Credit memos; Marketing → Coupons (list with status badges, create/edit form, disable).
- Storefront: order details show shipments with tracking links, invoices (link to a printable page), refunds. The cart's coupon box uses the server's answer in laravel mode (no client-side coupon table).

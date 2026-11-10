# Backend phase 4 contract: admin roles, content, reports, settings

**Status: built (2026-11-12).** Where this page left a shape open, the implementation's choice is documented in [backend/README.md](../../backend/README.md). Notable additions: only an Owner can give the Owner role or change an Owner's account (so `admins.manage` can't be used to promote yourself), and with tax enabled, refunds include each line's and the shipping's share of the tax.

The last backend phase. It builds on phases 1 to 3 and keeps their conventions (`snake_case`, money as 2-decimal strings, `{ data }`, Laravel 422 errors, admin token on `/api/admin/v1`). Modeled on Magento's **System → Permissions** (users and roles), **Content → Pages / Blocks**, **Reports**, and **Stores → Configuration**.

## 1. Admin users, roles, and permissions

Today every admin can do everything. Phase 4 adds roles with permissions, enforced **on the server for every admin route**.

- `admin_roles`: `id, name (unique), description, permissions json (list of permission keys), is_system bool, timestamps`. Seeded system roles (not deletable, permissions not editable): **Owner** (all permissions, including managing admins and roles), plus editable starters: **Sales staff** (orders, invoices, shipments, credit memos, customers view), **Catalog manager** (products, categories), **Marketing** (coupons, content), **Viewer** (all `*.view`).
- `admins` gains `role_id` (existing admins become Owner) and stays separate from customers.
- Permission keys (one per area and action):

| Area | Keys |
| --- | --- |
| Dashboard | `dashboard.view` |
| Catalog | `products.view`, `products.edit`, `products.delete`, `categories.edit` |
| Sales | `orders.view`, `orders.edit` (status, notes, cancel), `invoices.create`, `shipments.create`, `credit_memos.create` |
| Customers | `customers.view`, `customers.edit` (block/unblock) |
| Marketing | `coupons.view`, `coupons.edit` |
| Content | `content.view`, `content.edit` |
| Reports | `reports.view` |
| Settings | `settings.view`, `settings.edit` |
| System | `admins.manage` (admin users and roles), `audit.view` |

- Middleware `can.admin:<key>` on every admin route (a route without a permission is a bug; a test lists all `/api/admin/v1` routes and fails if any lacks one). Missing permission → **403** `{ message: "Your role doesn't allow this.", code: "permission_denied", permission: "orders.edit" }`.
- `GET /api/admin/v1/me` adds `role: { id, name }` and `permissions: [keys]` so the admin app can hide what the user can't do (the server still refuses).
- Admin users: `GET/POST /api/admin/v1/admins`, `GET/PATCH /api/admin/v1/admins/{id}` (`name, email, role_id, is_active`; POST also `password`, min 12 with letters and numbers), `POST /api/admin/v1/admins/{id}/reset-password` (sets a new password given by the Owner; signs that admin out everywhere). Rules: you can't deactivate or demote yourself; there must always be at least one active Owner (422 otherwise). Deactivating signs the admin out everywhere.
- Roles: `GET/POST /api/admin/v1/roles`, `PATCH/DELETE /api/admin/v1/roles/{id}` (system roles: 422; deleting a role in use: 422 naming how many admins use it). `GET /api/admin/v1/permissions` → the grouped key list with labels for the role form.

## 2. Audit log

- `audit_log`: `id, admin_id, action (e.g. "product.updated"), subject_type, subject_id, summary, changes json (before/after of changed fields; never passwords or tokens), ip, created_at`.
- Written for: product create/update/delete, category changes, order status/notes, invoices, shipments, credit memos, customer block/unblock, coupon changes, content changes, settings changes, admin and role changes, admin sign-in and failed admin sign-in (no admin_id; email in summary).
- `GET /api/admin/v1/audit?admin_id&action&subject_type&from&to&page` (`audit.view`).

## 3. Content (CMS)

- `pages`: `id, slug (unique, lower-case, a-z0-9-), title, body (sanitized HTML), meta_title null, meta_description null, is_published bool, timestamps`. Seeded: `about`, `shipping-and-returns`, `privacy`, `terms`, `contact` with sensible starter copy.
- **Body HTML is sanitized on save** with an allow-list (p, h2, h3, h4, ul, ol, li, strong, em, a[href with http(s)/mailto/relative only, rel="noopener"], blockquote, br, hr, table elements). Scripts, styles, event attributes, iframes, and `javascript:` URLs are removed. Tests prove it.
- Home content (`home_content` single row or a settings group): `hero { eyebrow, title, description, primary_cta { label, url }, secondary_cta, image_url, image_alt, highlights [3] }`, `banners [{ id, eyebrow, title, description, cta { label, url }, image_url, image_alt, tone (navy|emerald|amber|rose), position, is_active }]`, `featured_product_ids [up to 8]`. Seeded from `frontend/src/data/homeContent.js` so the home page looks the same.
- Public: `GET /api/v1/pages/{slug}` (published only, else 404), `GET /api/v1/home` → `{ data: { hero, banners (active, by position), featured_products [ProductResource, active only] } }`.
- Admin (`content.view` / `content.edit`): `GET/POST /api/admin/v1/pages`, `GET/PATCH/DELETE /api/admin/v1/pages/{id}`, `GET/PUT /api/admin/v1/home`.

## 4. Reports (`reports.view`)

All money from orders that aren't cancelled, minus credit memos where stated; date range `from`, `to` (inclusive, store time zone `UTC` for now, max 366 days, default last 30 days); `group_by` = `day|week|month`.

| Endpoint | Answer `data` |
| --- | --- |
| `GET /reports/sales` | `{ totals: { orders, units, gross, discounts, shipping, refunds, net, average_order }, series: [{ period: "2026-11-10", orders, gross, refunds, net }] }` (every period in range present, zeros included) |
| `GET /reports/products?limit=10` | best sellers `[{ product_id, name, sku, units, revenue }]` |
| `GET /reports/customers` | `{ new_customers, returning_customers, guest_orders, top_customers: [{ id, name, email, orders, spent }] (10) }` |
| `GET /reports/coupons` | `[{ code, uses, discount_total }]` |
| `GET /reports/low-stock` | products below the low-stock threshold, lowest first |

`GET /reports/sales.csv` (and `products.csv`) return the same data as CSV (`text/csv`, `Content-Disposition: attachment`), with values starting with `= + - @` prefixed by `'` (CSV injection).

## 5. Store settings (`settings.view` / `settings.edit`)

- `settings`: `key (unique), value json, timestamps`, read through a cached `Settings` service (cache cleared on save). Values replace the phase 2/3 config:

| Group | Keys |
| --- | --- |
| General | `store_name` ("BuyNest"), `support_email`, `support_phone`, `address` |
| Shipping | `standard_price` 4.99, `free_shipping_threshold` 50.00, `express_price` 12.99, `next_day_price` 24.99, `enabled_methods` [standard, express, nextDay] |
| Tax | `tax_enabled` false, `tax_rates` [{ country, rate (percent, 2 decimals) }], `prices_include_tax` false |
| Checkout | `allowed_countries` (the current 7), `guest_checkout` true, `enabled_payment_methods` [card, paypal, cod] |
| Inventory | `low_stock_threshold` 10 |

- Tax (when enabled): `rate` for the shipping country × (merchandise after discount + shipping), rounded to the cent, shown as `tax` in cart/validate and orders (orders store it in `tax_total`). With no rate for the country, tax is 0. Cart/validate needs a `country` for tax: optional field; without it tax is 0 and the answer says `tax_estimated: false`.
- `guest_checkout: false` → guest orders get 403 `{ code: "guest_checkout_disabled" }`; payment and shipping methods not enabled → 422.
- `GET /api/admin/v1/settings` → all groups; `PATCH /api/admin/v1/settings` `{ group: { key: value } }` with validation per key.
- Public: `GET /api/v1/store` → `{ data: { store_name, support_email, support_phone, shipping_methods: [{ id, label, eta, price }], free_shipping_threshold, allowed_countries, payment_methods: [ids], guest_checkout, tax_enabled } }` so the storefront shows the same rules the server applies (replacing its `constants/store.js` values in real mode).

## Browser-facing routes (sign-in service)
- Store: `GET /api/catalog/home`, `GET /api/catalog/pages/{slug}`, `GET /api/catalog/store` (public, cached 60 s).
- Admin: `/api/admin/admins…`, `/roles…`, `/permissions`, `/audit`, `/pages…`, `/home`, `/reports/*` (CSV passed through with its headers), `/settings`; `/api/admin/me` includes `role` and `permissions`. A 403 `permission_denied` is passed through unchanged.

## UI
- Admin: navigation shows only what the role allows; pages for Admin users (list, invite/create with role, edit, deactivate, reset password), Roles (permission checkboxes grouped by area), Audit log (filters), Content pages (list, editor: a textarea with a live sanitized preview is enough; no WYSIWYG library), Home page editor (hero, banners with reorder, featured product picker by search), Reports (date range, group-by, KPI tiles + a simple accessible bar chart or table per series, CSV download), Settings (grouped forms). A friendly "You don't have access" screen for 403 `permission_denied`.
- Storefront (real mode): home page from `/api/catalog/home`; footer links to the CMS pages; route `/pages/:slug`; shipping prices, free-shipping threshold, countries, payment methods, and guest checkout from `/api/catalog/store`; tax line shown when enabled.

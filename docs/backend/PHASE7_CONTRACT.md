# Backend phase 7 contract: Magento-style marketing and system

**Status: built (2026-11-16).** Choices made where this page left something open are in the implementation notes (parts A and B) at the end.

Builds on phases 1 to 6 and keeps their conventions (`snake_case`, money as 2-decimal strings, `{ data }`, Laravel 422 errors, `can.admin:<key>` on every admin route, an audit entry for every admin change, emails through the existing mailer and dev inbox). Modeled on Magento's **Marketing → Catalog price rules / Cart price rules / Newsletter**, **Marketing → SEO & search (URL rewrites, search terms, site map)**, **Reports → Abandoned carts / Search terms**, **Stores → Email templates**, the admin **dashboard**, and **System → Notifications**.

## 1. Catalog price rules (automatic sales)

- `catalog_rules`: `id, name, description null, is_active, starts_at null, ends_at null, customer_group_ids json (empty = everyone, including guests), category_ids json (empty = every category; a category includes its descendants), product_ids json (empty = no product limit), action (percent|fixed), amount, priority (lower first), stop_further bool, timestamps`.
- A product's price for a shopper = the lowest of: its own discounted price, and the result of applying the matching active rules in priority order (stopping after a rule with `stop_further`) to its base price. Variant prices follow the same rule. The price never goes below 0.01.
- Rules for everyone show in the storefront catalog (listing, product page, search) as the sale price. Rules limited to customer groups apply in cart validation, checkout, and admin-created orders (and the cart line says "VIP price").
- Active rules are cached; the cache clears when a rule changes and when a rule's start or end time passes (scheduled every minute in production, checked on read in development).
- Admin (`price_rules.manage`, read with `coupons.view`): `GET/POST /catalog-rules`, `GET/PATCH/DELETE /catalog-rules/{id}`, `GET /catalog-rules/{id}/preview` → the first 50 affected products with old and new price.

## 2. Cart price rules (coupons with conditions)

The phase 3 coupons grow into Magento-style cart rules:

- `coupons` gains: `min_subtotal null`, `customer_group_ids json` (empty = everyone), `applies_to` (`all|categories|products`) with `category_ids`/`product_ids`, `free_shipping` bool, `buy_quantity`/`get_quantity` (buy X get Y free: for every X+Y eligible units, the cheapest Y are free), `uses_per_customer null`, `auto_apply` bool (no code needed; the best automatic rule is applied by itself, and a typed code may be combined with at most one automatic rule).
- `code` becomes nullable for automatic rules.
- The discount is spread over the **eligible** lines only (proportionally), so the existing refund math stays correct per line.
- Cart validation and orders show each applied rule's label.
- The 422 messages say why a code doesn't apply ("Spend $20.00 more to use this code", "This code isn't available for your account", "This code applies to Shoes only").
- Admin coupon form gains these fields; the coupon report shows automatic rules by name.

## 3. Newsletter

- `newsletter_subscribers`: `id, email (unique), customer_id null, status (pending|subscribed|unsubscribed), confirm_token_hash null, confirmed_at null, unsubscribed_at null, source (footer|account|checkout|admin), timestamps`.
- Double opt-in: `POST /api/v1/newsletter` `{ email }` always answers 202 with the same message (no way to learn whether an email is subscribed) and sends a confirmation link; `POST /api/v1/newsletter/confirm` `{ token }`; `POST /api/v1/newsletter/unsubscribe` `{ token }` from a signed link in every newsletter email (no sign-in needed). Signed-in customers toggle it in Account (`PATCH /api/v1/me` `{ newsletter: bool }`, no confirmation needed because the email is verified). Rate-limited.
- Campaigns: `newsletter_campaigns`: `id, subject, preheader null, body (sanitized HTML, same allow-list as content pages), status (draft|sending|sent), sent_count, created_by_admin_id, sent_at null, timestamps`. Send test to the admin's own email; send to all subscribed via queued jobs in batches of 100 (the dev inbox in development), each with an unsubscribe link and a `List-Unsubscribe` header.
- Admin: `newsletter.view` (subscribers list with filters, export CSV, campaigns list), `newsletter.send` (create, edit, test-send, send; unsubscribe a subscriber).
- The storefront's newsletter form (footer) uses the real endpoint in real mode.

## 4. Email templates

- `email_templates`: `id, key (unique), subject, body (sanitized HTML), is_customized, updated_by_admin_id, timestamps` for every email the store sends: email verification code, password reset code, set your password (admin-created customer), order confirmation, order status update, invoice, shipment, credit memo, return status, newsletter confirmation, abandoned cart reminder.
- Variables written as `{{ name }}` from a fixed list per template (for example `{{ customer_first_name }}`, `{{ order_number }}`, `{{ code }}`, `{{ items_table }}`); unknown variables: 422. Templates that carry a code or a link require that variable (you can't save a verification email without `{{ code }}`). Values are HTML-escaped when inserted, except the prebuilt blocks (`items_table`, `address`, `button`).
- Defaults live in code; "Reset to default" deletes the customization.
- Admin (`email_templates.manage`): list, edit with the variable list, live preview with sample data, send test to self, reset.

## 5. SEO and search

- Products and categories gain `meta_title` and `meta_description` (categories already have them from phase 5). The storefront sets the page `<title>`, meta description, canonical link, and Open Graph tags from them (falling back to name and description).
- `GET /api/v1/sitemap.xml` → active products, visible categories, published pages; served by the sign-in service at `/sitemap.xml`, with `/robots.txt` pointing to it (`Disallow: /admin/`, `/account`, `/checkout`, `/api/`).
- URL redirects: `url_redirects`: `id, from_path (unique, starts with "/", no query), to_path (store path or https URL), status_code (301|302), hits, timestamps`. `GET /api/v1/redirects?path=` (public, cached) is checked by the storefront's "not found" page, which then navigates there; the sign-in service also answers a real 301/302 for the production server's `index.html` fallback when the path matches. Admin (`seo.manage`): list, add, edit, delete; import CSV.
- Deleting a product or category, or changing a page's slug, offers to add a redirect (admin UI).
- Search terms: the catalog search records `search_terms` (`term` normalized lower-case, trimmed, max 100 chars; `hits`, `last_results_count`, `updated_at`). One count per term per visitor per hour (keyed by client IP hash, never stored). Admin report: top terms and terms with zero results (`reports.view`). Synonym/redirect per term: `search_terms.redirect_url` null (searching that exact term goes straight to the URL), `seo.manage`.

## 6. Abandoned carts

- `customer_carts`: `customer_id (unique), items json (product_id, variant_id, quantity), subtotal, item_count, updated_at, reminded_at null, converted_at null`. Saved whenever a signed-in customer's cart is validated (the storefront validates the cart on cart and checkout pages); cleared (converted) when they place an order; an empty cart deletes the row.
- Report (`reports.view`): carts not updated for at least 1 hour and not converted, with customer, items, subtotal, age; filter by age and minimum subtotal.
- `POST /reports/abandoned-carts/{customer_id}/remind` (`newsletter.send`): emails the "You left something in your cart" template (at most once per 72 hours per cart, and only to active customers).
- A signed-in customer's cart is restored on another device from `GET /api/v1/me/cart` (merged with the local cart: quantities added, capped by stock).

## 7. Admin dashboard and notifications

- `GET /overview` grows into Magento's dashboard: lifetime sales, average order, revenue chart (last 30 days), last 5 orders, bestsellers (5), new customers (5), top search terms (5), and to-do counts (orders to invoice, orders to ship, return requests, pending reviews, low-stock products). Each block is only included when the admin has the matching `*.view` permission.
- `admin_notifications`: `id, type, severity (info|warning|critical), title, body, link null, permission (the key needed to see it), created_at`; `admin_notification_reads`: `admin_id, notification_id, read_at`. Created for: a product reaching low stock or 0, a new return request, a new review waiting for approval, a failed newsletter batch. No duplicates for the same subject while one is unread.
- `GET /notifications?unread` (only those the admin's permissions allow), `POST /notifications/{id}/read`, `POST /notifications/read-all`. No extra permission: it's filtered by the stored `permission`.
- Grid preferences: `admin_preferences`: `admin_id, key, value json`. `GET/PUT /preferences/{key}` for the admin's own visible columns, page size, and saved filters on the products, orders, and customers grids.

## 8. Permissions and roles

New keys: `price_rules.manage` (Marketing), `newsletter.view`, `newsletter.send` (Marketing), `email_templates.manage` (Content), `seo.manage` (Content). Starter roles: **Marketing** gets `price_rules.manage`, `newsletter.view`, `newsletter.send`, `seo.manage`; **Viewer** gets `newsletter.view`. `email_templates.manage` is Owner-only by default. A migration gives existing roles their new keys.

## Browser-facing routes (sign-in service)

- Store: `/api/shop/newsletter` (+ confirm, unsubscribe), `/api/shop/me/cart`, `/api/catalog/redirects`, `/sitemap.xml`, `/robots.txt`.
- Admin: `/api/admin/catalog-rules…`, coupon fields passed through, `/api/admin/newsletter/subscribers…`, `/api/admin/newsletter/campaigns…`, `/api/admin/email-templates…`, `/api/admin/redirects…`, `/api/admin/search-terms…`, `/api/admin/reports/abandoned-carts…`, `/api/admin/reports/search-terms`, `/api/admin/notifications…`, `/api/admin/preferences/{key}`.

## UI

- **Storefront** (real mode)
  - Prices show rule-based sales, and the cart shows group or rule labels.
  - Newsletter: the footer form and the confirm and unsubscribe pages work, and Account has a newsletter toggle.
  - Every page has meta and Open Graph tags.
  - Redirects are followed from the not-found page.
  - A signed-in cart is restored on another device.
- **Admin**
  - **Marketing:** Catalog price rules (list and form with a preview of affected products), richer coupon form, Newsletter subscribers and Campaigns (editor with live sanitized preview, send test, send).
  - **Content:** Email templates (editor, variables, preview, test, reset), URL redirects, Search terms.
  - **Reports:** Abandoned carts (with the remind button) and Search terms.
  - **Dashboard:** the new blocks.
  - **Header:** a notifications bell with an unread count (polling every 60 seconds), a list, and mark read.
  - **Grids:** column chooser and saved filters on products, orders, and customers.

## Tests

Backend feature tests for every rule (rule matching by group, category descendants and dates, best price wins, never below 0.01; cart rules: minimum subtotal, groups, eligible-lines-only discount and correct refunds, buy X get Y, free shipping, uses per customer, automatic + code combination; newsletter: same answer for known and unknown emails, confirm, unsubscribe token, campaign batches and unsubscribe header; email templates: required variables, escaping, reset; sitemap contents, redirects, search term counting limits; abandoned cart saving, conversion, reminder limit, cart restore; dashboard blocks per permission; notifications filtered by permission and not duplicated; permissions on every new route). Storefront and admin unit tests for the new UI, and a new browser suite `e2e/marketing.mjs`.

## Left out on purpose

Several websites or store views from one admin, several currencies, stock in several warehouses (Magento MSI), Magento's cache and index management screens, and "log in as customer". These suit very large stores and add a lot of risk for little benefit here. Any of them can be planned later if needed.

## Implementation notes — part A (pricing and search)

Backend choices for §1, §2, the search-terms part of §5, and `price_rules.manage`. Paths are under `/api/admin/v1` (admin) or `/api/v1` (store). Money is a `"0.00"` string, dates ISO 8601 UTC, lists are Laravel's paginated `{ data, links, meta }` unless shown otherwise.

**Catalog price rules**
- Rule item (admin): `{ id, name, description, is_active, status ("active"|"inactive"|"scheduled"|"expired"), starts_at (ISO|null), ends_at (ISO|null), customer_group_ids: [int], category_ids: [int], product_ids: [int], action ("percent"|"fixed"), amount: "10.00", priority (int, lower first), stop_further (bool), created_at, updated_at }`.
- `GET /catalog-rules?search&status&page&per_page` (`coupons.view`; sorted by priority, then id). `GET /catalog-rules/{id}` → `{ data: item }`. `POST` (201) / `PATCH` (only the fields sent) / `DELETE` (204) need `price_rules.manage`. Unknown id → 404 `{ message: "Catalog price rule not found." }`.
- Body: `name` (required on POST, max 120), `description` (max 500), `is_active` (default true), `starts_at`/`ends_at` (a bare `YYYY-MM-DD` means the start / end of that day UTC; `ends_at` must be after `starts_at`), `customer_group_ids`/`category_ids`/`product_ids` (arrays of existing ids, default `[]`), `action` (required on POST), `amount` (required on POST; percent 0.01–100, fixed > 0, at most 2 decimals), `priority` (0–1000, default 0), `stop_further` (default false). 422 fields are the field names (`customer_group_ids.0`, `amount`, …).
- Matching: active now, the shopper's group in `customer_group_ids` (or empty), the product's category inside one of `category_ids` **or their descendants** (or empty), and the product in `product_ids` (or empty). Category and product limits both apply when both are set.
- Price = min(own sale price, rules applied in priority order (then id) to the base price — the variant's own price when it has one — stopping after a `stop_further` rule), never below 0.01. Percent rounds halves up per unit. A tie keeps the own price (no rule label). The customer-group discount (phase 6) then comes off that price, as before.
- `GET /catalog-rules/{id}/preview` (`coupons.view`) → `{ data: [{ product_id, name, sku, thumbnail_url, status, price, old_price, new_price, has_variants }], meta: { total } }`: the first 50 matching products (not deleted, any status, by id) with `old_price` = the product's own sale price and `new_price` = with **this rule alone** applied (groups and dates ignored, so a scheduled rule can be previewed). `total` = all matching products.
- Storefront (`GET /products`, `/products/{id}`, search): rules for everyone only. `sale_price` (and each variant's `final_price`) are the rule price when it wins; products gain `price_rule: { id, name } | null`. `discount_percent` stays the product's own. The `min_price`/`max_price` filters and the `price` sort still use the product's own sale price (rules are not in SQL).
- Cart, checkout, admin quote and admin orders: rules for everyone and the shopper's group (guests = General). Lines gain `price_rule: { id, name } | null` and `price_label: string | null` (`"VIP price"` — the group's name + " price" — when the winning rule is limited to groups, else the rule's name); `base_sale_price` is the rule price when a rule wins (before the group discount). Order items gain `price_label` (null before phase 7).
- Cache: the active rules are cached (`catalog_rules.active`) until the next start or end time of any rule; saving or deleting a rule, or changing a category, clears it. `php artisan buynest:refresh-price-rules` runs every minute in the scheduler; reads also check the time, so development works without the scheduler.
- Audit: `catalog_rule.created`, `catalog_rule.updated`, `catalog_rule.deleted` (subject `catalog_rule`).

**Cart price rules (coupons)**
- Coupon item gains `{ customer_group_ids: [int], applies_to ("all"|"categories"|"products"), category_ids: [int], product_ids: [int], free_shipping (bool), buy_quantity (int|null), get_quantity (int|null), auto_apply (bool) }`; `code` is `null` for automatic rules. The contract's `uses_per_customer` is the existing **`usage_limit_per_customer`**; `min_subtotal` already existed.
- `type` gains `"buy_x_get_y"` (needs `buy_quantity` 1–100 and `get_quantity` 1–100; `value` is ignored and saved as 0.00). `free_shipping: true` can be added to any type; type `free_shipping` always has `free_shipping: true` and no merchandise discount.
- Validation: `auto_apply: true` → `code` must be empty (422 `code`: "An automatic rule has no code."); `auto_apply: false` → `code` required. `applies_to: "categories"` needs `category_ids` (1+ existing ids), `"products"` needs `product_ids` (422 on those fields). `customer_group_ids` existing group ids.
- An automatic rule's name is its `description` (auto-written from the rule when left empty). The admin list gains `?kind=code|automatic`.
- Eligible lines: every available line (`all`), lines whose product is in one of `category_ids` or their descendants, or in `product_ids`. Percent/fixed discounts are computed on the eligible lines' total and shared over them in proportion (cents add up exactly); buy X get Y: for every X+Y eligible units the cheapest Y are free (their sale price after the group discount), charged to the lines those units are on. Free shipping makes every method free when the rule applies (to the whole order).
- Order of checks (first failure is the message): not valid / not active yet / expired; group → "This code isn't available for your account."; no eligible line → "This code applies to Shoes only." (category names joined with ", " and " and "; products: up to 3 names, else "selected products"); minimum (cart subtotal after group prices) → **"Spend $20.00 more to use this code."** (was "Spend at least …"); fully used; per customer.
- Automatic rules: every active automatic rule that passes its checks is a candidate; the one saving the most (merchandise discount + the chosen shipping method's price when it gives free shipping; tie → lower id) applies by itself. A typed code is then applied on top (on what is left of each line after the automatic rule), so at most one automatic rule + one code. Automatic rules never produce a `coupon_error`.
- `POST /cart/validate` (and admin `orders/quote`): `coupon` stays `{ code, description } | null` (the typed code only). New `applied_rules: [{ id, code (null for automatic), label, automatic (bool), discount: "5.00", free_shipping (bool) }]` (automatic first). Lines gain `discount` ("0.00": that line's share of all cart rules). `totals.discount` = all rules together.
- Orders: `applied_rules` (same shape, saved at checkout; `[]` for orders before phase 7) in the store and admin order resources; items gain `discount` (their share; `null` before phase 7) and `price_label`. `coupon_code` stays the typed code. Every applied rule (automatic too) counts a use (`times_used`, per-customer limit) and is given back on cancel.
- Refunds use each item's stored `discount` (so a discount on the eligible lines never leaks into the others); older orders keep the proportional split.
- Coupon report `GET /reports/coupons` items: `{ coupon_id, code (null for automatic), name, automatic, uses, discount_total }` (from the rule uses of orders in the range, not cancelled; most used first).

**Search terms**
- `search_terms`: `id, term (unique), hits, last_results_count, redirect_url null, created_at, updated_at`.
- Recorded by `GET /api/v1/products?search=` (term lower-cased, trimmed, inner spaces collapsed, cut to 100 chars; empty terms ignored). One count per term per visitor (hash of the client IP, cache only) per hour; a counted search also saves `last_results_count` (the total matching products).
- When the normalized term has a `redirect_url`, the products answer adds `meta.redirect_url` (otherwise `meta.redirect_url: null` on every search request; absent without `search`). The products are still returned; the storefront should navigate to the URL.
- Item (admin): `{ id, term, hits, last_results_count, redirect_url, created_at, updated_at }`.
- `GET /reports/search-terms?type=top|zero&search&page&per_page` (`reports.view`): `top` (default) = most hits first; `zero` = `last_results_count = 0`, most hits first.
- `GET /search-terms?search&has_redirect&page&per_page` (`seo.manage`, most hits first), `POST /search-terms { term, redirect_url }` (201; a term nobody searched yet), `PATCH /search-terms/{id} { redirect_url }` (null clears it), `DELETE /search-terms/{id}` (204). `redirect_url`: a store path starting with `/` (not `//`) or an `https://` URL, max 2048 (422 `redirect_url`). Duplicate term → 422 `term`. Audit: `search_term.created`, `search_term.updated`, `search_term.deleted`.

**Permissions**
- `price_rules.manage` (Marketing) added; migration `2026_11_17_000150_grant_price_rules_permission` gives the existing "Marketing" role `price_rules.manage`.

## Implementation notes — part B (newsletter, email templates, SEO, carts, dashboard, notifications)

Backend choices for §3, §4, §5 (product meta, sitemap, redirects — search terms are part A), §6, §7, and the keys `newsletter.view`, `newsletter.send`, `email_templates.manage`, `seo.manage`. Paths are under `/api/admin/v1` (admin) or `/api/v1` (store). Money is a `"0.00"` string, dates ISO 8601 UTC (`2026-11-17T10:00:00Z`), lists are Laravel's paginated `{ data, links, meta }` unless shown otherwise. Links in emails point at the storefront: `STOREFRONT_URL` (env, default `http://localhost:5173`).

**Newsletter (store)**
- `POST /newsletter { email, source? ("footer"|"checkout", default "footer") }` → always **202** `{ message: "Thanks! If this address isn't subscribed yet, we've sent you a link to confirm." }` — for new, pending, unsubscribed, and already subscribed emails alike (an already subscribed email gets no email). 422 only for a missing/invalid `email`. Rate limit `newsletter`: 10 per minute per visitor and 3 per hour per email (429 as elsewhere).
- The confirmation email (template `newsletter_confirmation`) links to `{STOREFRONT_URL}/newsletter/confirm?token=…`. A new request replaces the previous token; tokens last 7 days.
- `POST /newsletter/confirm { token }` → 200 `{ message: "You're subscribed to the BuyNest newsletter.", data: { email, status: "subscribed" } }` (clicking the link again within 7 days answers the same). Bad or expired → 422 `token`: "This confirmation link is invalid or has expired. Subscribe again to get a new one."
- `POST /newsletter/unsubscribe { token }` (no sign-in) → 200 `{ message: "You're unsubscribed. You won't get any more newsletters.", data: { email, status: "unsubscribed" } }`. The token is signed (`{id}.{hmac}`), never expires, and appears in every newsletter email as `{STOREFRONT_URL}/newsletter/unsubscribe?token=…`. Bad token → 422 `token`: "This unsubscribe link is invalid."
- Signed-in: `GET /me` (and the `customer` in sign-in answers) adds `newsletter: bool`; `PATCH /me { newsletter: true|false }` subscribes at once (source `account`, no confirmation) or unsubscribes the customer's email.
- Browser routes (sign-in service): `/api/shop/newsletter`, `/api/shop/newsletter/confirm`, `/api/shop/newsletter/unsubscribe` → the three above (pass the visitor IP as usual).

**Newsletter (admin)**
- Subscriber item: `{ id, email, status ("pending"|"subscribed"|"unsubscribed"), source ("footer"|"account"|"checkout"|"admin"), customer: { id, name } | null, confirmed_at, unsubscribed_at, created_at, updated_at }`.
- `GET /newsletter/subscribers?status&source&search(email)&page&per_page` (`newsletter.view`, newest first) + `meta.counts: { pending, subscribed, unsubscribed }`.
- `GET /newsletter/subscribers/export.csv` (same filters, `newsletter.view`) → `newsletter-subscribers-YYYY-MM-DD.csv`: `email,status,source,customer_id,customer_name,confirmed_at,unsubscribed_at,created_at` (CSV injection guard).
- `POST /newsletter/subscribers/{id}/unsubscribe` (`newsletter.send`) → `{ data: subscriber }`. Audit `newsletter.subscriber_unsubscribed`.
- Campaign list item: `{ id, subject, preheader, status ("draft"|"sending"|"sent"), recipient_count, sent_count, failed_count, created_by: { id, name } | null, sent_at, created_at, updated_at }`; detail = list item + `{ body }` (sanitized HTML).
- `GET /newsletter/campaigns?status&search&page&per_page` and `GET /newsletter/campaigns/{id}` (`newsletter.view`). `POST /newsletter/campaigns { subject (max 150), preheader? (max 150), body (max 100000) }` → 201 detail; `PATCH` (same fields, only sent ones) → detail; `DELETE` → 204 — all `newsletter.send`, and only while `draft` (otherwise 422 `campaign`: "This campaign has already been sent, so it can't be changed."). Body is sanitized on save with the content-page allow-list. Unknown id → 404 `Campaign not found.`
- `POST /newsletter/campaigns/{id}/test` (`newsletter.send`, any status) → 200 `{ message: "Test email sent to you@….", data: { email } }`: subject prefixed `[Test] `, sent to the signed-in admin.
- `POST /newsletter/campaigns/{id}/send` (`newsletter.send`) → **202** `{ message, data: campaign detail }`. Draft only (422 `campaign`), at least one subscribed address (422 `campaign`: "Nobody is subscribed yet."). Status becomes `sending`, `recipient_count` = subscribed addresses at that moment, and queued jobs send batches of 100 (status `sent` + `sent_at` after the last batch; `sent_count`/`failed_count` grow per batch). With `QUEUE_CONNECTION=sync` (development) it finishes before the answer, so `data.status` is already `sent`. A batch with failures creates a `newsletter_failed` admin notification. Each email: the campaign body in the store layout, the preheader as hidden preview text, an unsubscribe link in the footer, and the header `List-Unsubscribe: <{STOREFRONT_URL}/newsletter/unsubscribe?token=…>`. The dev inbox (`/dev/mailbox`) now also records that header (`dev_mailbox.headers` JSON).
- Audit: `newsletter.campaign_created`, `newsletter.campaign_updated`, `newsletter.campaign_deleted`, `newsletter.campaign_sent`.

**Email templates (admin, `email_templates.manage`)**
- Keys: `email_verification`, `password_reset`, `set_password`, `order_confirmation`, `order_status`, `invoice`, `shipment`, `credit_memo`, `return_status`, `newsletter_confirmation`, `abandoned_cart`. Every email the store sends renders from these (defaults in code; a saved row overrides subject and body). The store frame (logo, card, footer) stays in code around the body; the plain-text part is made from the rendered HTML.
- List `GET /email-templates` → `{ data: [{ key, name, description, subject, is_customized, updated_at (null for defaults), updated_by: { id, name } | null }] }` (not paginated, fixed order).
- Detail `GET /email-templates/{key}` → `{ data: list item + { body, default_subject, default_body, variables: [{ name, label, kind: "text"|"block", required }], required: [["code"]] } }`. `required` is a list of groups: each group must have at least one of its variables in the subject or body (e.g. `newsletter_confirmation`: `[["button","confirm_url"]]`); `variables[].required` is true for a variable that is a group alone. Unknown key → 404 `Email template not found.`
- Variables are written `{{ name }}` (spaces optional). Text variables are HTML-escaped; `kind: "block"` variables are prebuilt HTML (`items_table`, `address`, `button`, `tracking`, `note`, `resolution`) and are only allowed in the body. Empty blocks (no note, no tracking link) leave nothing behind.
- `PUT /email-templates/{key} { subject (1–200), body (1–100000) }` → detail (`is_customized: true`). Body sanitized (content-page allow-list). 422 on `subject`/`body`: "Unknown variable {{ foo }}. Use only the variables listed for this template." / "{{ items_table }} can only be used in the body." / on `body`: "This template must include {{ code }}." ("… {{ button }} or {{ confirm_url }}."). Audit `email_template.updated`.
- `POST /email-templates/{key}/preview { subject?, body? }` → `{ data: { subject, html, text } }` with sample data (unsaved drafts allowed; missing fields use the saved template; same 422s). `html` is the whole email document (use it in a sandboxed iframe).
- `POST /email-templates/{key}/test { subject?, body? }` → 200 `{ message, data: { email } }`: the sample email to the signed-in admin, subject prefixed `[Test] `.
- `POST /email-templates/{key}/reset` → detail with the defaults (`is_customized: false`); deletes the saved row. Audit `email_template.reset`.

**SEO**
- Products gain `meta_title` (max 190) and `meta_description` (max 500), nullable: admin product POST/PATCH and the admin product resource; the public product **detail** (`GET /api/v1/products/{id}`) adds both (null = fall back to name/description). Categories and pages already have them.
- `GET /api/v1/sitemap.xml` → `application/xml` `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` with `<url><loc>…</loc><lastmod>YYYY-MM-DD</lastmod></url>` for `{STOREFRONT_URL}/` (no lastmod), every visible category `/categories/{slug}`, every product for sale `/products/{id}`, every published page `/pages/{slug}`. Cached 15 minutes (`Cache-Control: public, max-age=900`). The sign-in service serves it at `/sitemap.xml` and writes `/robots.txt` itself (`Sitemap: {origin}/sitemap.xml`, `Disallow: /admin/`, `/account`, `/checkout`, `/api/`).
- Redirect item: `{ id, from_path, to_path, status_code (301|302), hits, created_at, updated_at }`. `from_path`: starts with `/`, no query or `#`, no spaces, max 255, stored lower-case without a trailing slash, not `/` itself, unique (422 `from_path`: "A redirect from this path already exists."). `to_path`: a store path starting with `/` (not `//`, may have a query) or an `https://` URL, max 2048; not the same as `from_path`, and not a loop through other redirects (422 `to_path`: "This would loop back to /old-path."). `status_code` default 301.
- Public `GET /api/v1/redirects?path=/Old-Path/?utm=x` (the path is normalized the same way: query, `#`, trailing slash dropped, lower-case) → 200 `{ data: { from_path, to_path, status_code } }` (counts a hit) or 404 `{ message: "No redirect for this path." }`; `Cache-Control: public, max-age=300` on both. Browser route `/api/catalog/redirects?path=`.
- Admin (`seo.manage`): `GET /redirects?search&status_code&page&per_page` (newest first; search in both paths), `GET /redirects/{id}`, `POST /redirects` → 201, `PATCH /redirects/{id}` → item, `DELETE /redirects/{id}` → 204 (404 `Redirect not found.`). `POST /redirects/import` multipart `file` (CSV, max 2 MB, header row `from_path,to_path[,status_code]`, max 5000 rows) → 200 `{ data: { created, updated, errors: [{ line, message }] } }` (an existing `from_path` is updated; bad rows are skipped and listed). Audit `redirect.created`, `redirect.updated`, `redirect.deleted`, `redirect.imported`.

**Abandoned carts**
- Saved on `POST /cart/validate` when a customer token is sent: the items (`product_id, variant_id, quantity`, same product+variant merged), `subtotal` = the answer's `totals.subtotal`, `item_count` = units. An empty cart deletes the row. Guests are never saved. The cart answer doesn't change.
- When that customer places a storefront order, the cart is marked converted (`converted_at`); `GET /me/cart` then answers no items, and the next validation with items starts a fresh cart.
- `GET /api/v1/me/cart` → `{ data: { items: [{ product_id, variant_id, quantity }], item_count, updated_at | null } }`: only items still for sale, each quantity capped by current stock (product or variant), sold-out items left out.
- `POST /api/v1/me/cart/merge { items: [{ product_id, variant_id?, quantity }] }` (max 50 lines) → same shape: the local items are **added** to the saved cart (same product+variant: quantities added), capped by stock (and 999), saved. Call it **once** right after sign-in with the browser's cart, then replace the browser cart with the answer (calling it again would add the quantities again). Browser routes `/api/shop/me/cart`, `/api/shop/me/cart/merge`.
- Report `GET /reports/abandoned-carts?min_age_hours (default 1, min 1)&max_age_days&min_subtotal&search (name/email)&sort (newest|oldest|subtotal)&page&per_page` (`reports.view`): carts not converted, with items, untouched for `min_age_hours`. Item: `{ customer: { id, name, email, is_active }, items: [{ product_id, variant_id, name, variant_label, sku, thumbnail_url, quantity, sale_price, available }], item_count, subtotal, updated_at, age_minutes, reminded_at, can_remind, remind_available_at }` (`sale_price` = today's product/variant sale price; `can_remind` false when the customer is blocked/unverified or reminded in the last 72 hours).
- `POST /reports/abandoned-carts/{customer_id}/remind` (`newsletter.send`) → 200 `{ message: "Reminder sent to …", data: { customer_id, email, reminded_at } }` and the `abandoned_cart` email (items table, subtotal, a button to `{STOREFRONT_URL}/cart`). No abandoned cart (none, converted, empty) → 404 `{ message: "Abandoned cart not found." }`; touched less than an hour ago → 422 `cart`; blocked or unverified customer → 422 `customer`; reminded in the last 72 hours → 429 `{ message, code: "too_soon" }` with `Retry-After` (seconds). Audit `cart.reminded` (subject `customer`).

**Dashboard (`GET /overview`, `dashboard.view`)**
Each block is present only with its permission; `blocks` lists the ones included. Existing keys keep their shapes.
- `products`, `low_stock_products` → `products.view`. `orders` (lifetime sales = `orders.revenue`, average order = `orders.average_order`), `latest_orders` (the last 5), `revenue_chart` → `orders.view`. `customers`, `new_customers` → `customers.view`. `bestsellers`, `top_search_terms` → `reports.view`.
- `revenue_chart: [{ date: "2026-11-17", orders, revenue: "0.00" }]` — 30 days ending today (UTC), zeros included; orders placed that day that aren't cancelled, `revenue` = their grand totals.
- `bestsellers: [{ product_id, name, sku, units, revenue }]` (5, all time, not cancelled). `new_customers: [{ id, name, email, created_at }]` (5 newest). `top_search_terms: [{ term, hits, last_results_count }]` (5, most hits; `[]` until part A's table exists).
- `todo: { orders_to_invoice?, orders_to_ship?, return_requests?, pending_reviews?, low_stock_products? }` — always an object; each count only with `orders.view` (unpaid and not cancelled/closed; processing with no shipment), `returns.view` (status `requested`), `reviews.view` (status `pending`), `products.view` (below the threshold, 0 included).
- `low_stock_threshold` always.

**Admin notifications (no permission key; filtered by each notification's `permission`)**
- Item: `{ id, type, severity ("info"|"warning"|"critical"), title, body, link (admin app path) | null, created_at, read_at | null }`.
- Types: `low_stock` (warning, `products.view`, when a product's stock drops below the low-stock threshold; link `/products/{id}`), `out_of_stock` (critical, `products.view`, reaches 0), `return_requested` (info, `returns.view`, a customer's return request; link `/returns/{number}`), `review_pending` (info, `reviews.view`, a new review waiting for approval; link `/reviews?status=pending`), `newsletter_failed` (critical, `newsletter.send`, a campaign batch with failed emails; link `/newsletter/campaigns/{id}`).
- No duplicates: a notification of the same type for the same subject (product, return, review, campaign) isn't created again while no admin has read the previous one.
- `GET /notifications?unread=1&page&per_page (default 20, max 50)` → paginated, newest first, plus `meta.unread_count` (all unread the admin may see). `POST /notifications/{id}/read` → `{ data: item }` (404 `Notification not found.` when the admin can't see it). `POST /notifications/read-all` → `{ data: { marked }, meta: { unread_count: 0 } }`. Reads are per admin.

**Grid preferences (no permission key; own preferences only)**
- Keys: `products_grid`, `orders_grid`, `customers_grid` (others → 404 `Unknown preference.`).
- `GET /preferences/{key}` → `{ data: { key, value | null, updated_at | null } }`. `PUT /preferences/{key} { value: { columns?: [string ≤ 60] (≤ 50), page_size?: 10|20|25|50|100, sort?: string ≤ 60, direction?: "asc"|"desc", filters?: [{ name (1–60), params: object }] (≤ 20) } }` → same shape; the whole value is replaced; other keys inside `value` → 422; at most 16 KB of JSON.

**Permissions and migrations**
- Keys: `newsletter.view`, `newsletter.send` (Marketing; `newsletter.send` also covers cart reminders and subscriber unsubscribes), `email_templates.manage`, `seo.manage` (Content; `seo.manage` also guards part A's search-term redirects). Starter roles: Marketing gets `newsletter.view, newsletter.send, seo.manage`; Viewer gets `newsletter.view` (all `*.view` keys); `email_templates.manage` is Owner-only.
- Migrations `2026_11_17_0002xx_*`: newsletter tables, email templates, product meta + `url_redirects`, `customer_carts`, `admin_notifications` + `admin_notification_reads` + `admin_preferences`, `dev_mailbox.headers`, and `grant_phase7_marketing_permissions` (existing "Marketing" gets the three keys, "Viewer" gets `newsletter.view`).

# Backend phase 7 contract: Magento-style marketing and system

**Status: planned (2026-11-16).** Starts after phase 6 is built and verified.

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

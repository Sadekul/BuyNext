# Backend phase 5 contract: Magento-style catalog management

**Status: built (2026-11-16).** Choices the implementation made where this page left something open are listed in the implementation notes at the end.

Builds on phases 1 to 4 and keeps their conventions (`snake_case`, money as 2-decimal strings, `{ data }`, Laravel 422 errors, admin token on `/api/admin/v1`, `can.admin:<key>` on every admin route, audit log entries for every admin change). Modeled on Magento's **Catalog → Categories**, **Catalog → Products** (images, configurable products, mass actions), **System → Data transfer (Import / Export)**, and **Marketing → Reviews**.

The storefront's DummyJSON demo mode must keep working unchanged: everything below is only used when `VITE_API_PROVIDER=laravel`.

## 1. Category tree

Today `categories` is a flat list. Phase 5 makes it a tree.

- `categories` gains: `parent_id` (nullable, FK to `categories.id`), `description` text null, `is_active` bool default true, `meta_title` null, `meta_description` null. Existing categories become top-level, active.
- Depth at most 3 (top, child, grandchild). Moving a category under itself or one of its descendants: 422. `slug` stays unique store-wide, lower-case `a-z0-9-`.
- Products keep one `category_id` and may sit in any category of the tree.
- A category is "visible" when it and all its ancestors are active. Products in a category that isn't visible are left out of storefront listings and search, and their product page and cart validation treat them like a draft product (not available).
- Admin (`products.view` to read, `categories.edit` to change):
  - `GET /categories` → the full tree: `[{ id, name, slug, parent_id, position, is_active, image_url, description, meta_title, meta_description, product_count (direct), children: [...] }]` ordered by `position`, then `name`.
  - `POST /categories`, `PATCH /categories/{id}` (any field above except counts).
  - `DELETE /categories/{id}` → 422 if it has children or products (message says how many).
  - `POST /categories/reorder` `{ parent_id (nullable), ids: [..] }` → sets `position` for those siblings (all ids must share that parent).
- Public: `GET /api/v1/categories` adds `parent_id` and `children` the same way, visible categories only. `GET /api/v1/products?category=<slug>` includes products of that category **and its descendants**.

## 2. Product images (upload)

- `product_images` keeps `url, alt, position`, and gains `path` (nullable: set for uploaded files, null for imported external URLs).
- `POST /products/{id}/images` (multipart, field `images[]`, 1 to 10 files per request, at most 12 images per product) — `products.edit`.
  - Accepted: JPEG, PNG, WebP, detected from the file contents (not the name or the browser's type), max 5 MB each, max 6000×6000 px.
  - Stored on the `public` disk at `products/{product_id}/{random 32 hex}.{jpg|png|webp}`; never the original file name.
  - `url` is the store-relative path `/media/products/{product_id}/{name}` (see the sign-in service routes below).
- `PATCH /products/{id}/images/{imageId}` `{ alt }`, `DELETE /products/{id}/images/{imageId}` (also deletes the file), `POST /products/{id}/images/reorder` `{ ids: [...] }`.
- The product's `thumbnail_url` always follows the first image (position 0); with no images it keeps its current value.
- Deleting a product (soft delete) keeps its files; nothing else changes.

## 3. Product options and variants (Magento "configurable product")

- New tables:
  - `product_options`: `id, product_id, name (e.g. "Size"), position`. At most 3 options per product.
  - `product_option_values`: `id, option_id, value (e.g. "M"), position`. At most 20 values per option.
  - `product_variants`: `id, product_id, sku (unique across products and variants), option_value_ids json (one value id per option, sorted), price decimal null (null = the product's price), stock_quantity, is_active bool, timestamps`. Unique per product + combination.
- A product **with variants** sells only through a variant: its own `stock_quantity` is ignored (shown as the sum of active variants' stock), the discount percent still applies to the variant's price.
- Admin (`products.edit`): `PUT /products/{id}/options` `{ options: [{ name, values: [..] }] }` replaces the options; variants whose values no longer exist are deactivated (never deleted, so old orders keep their link). `POST /products/{id}/variants/generate` creates any missing combination (sku `{product_sku}-{value}-{value}` slugified, stock 0, inactive). `PATCH /products/{id}/variants/{variantId}` `{ sku, price, stock_quantity, is_active }`. `GET /products/{id}` includes `options` and `variants`.
- Public `GET /api/v1/products/{id}` adds `options: [{ id, name, values: [{ id, value }] }]` and `variants: [{ id, sku, option_value_ids, price, final_price, stock_quantity, in_stock }]` (active only). Products without variants: `options: []`, `variants: []`. Listing items add `has_variants`.
- Cart and checkout: each cart line may carry `variant_id`. A line for a product with variants and no (or an inactive, or another product's) `variant_id`: 422 on that line. Stock is checked and locked (`lockForUpdate`) on the variant. The same product with two different variants is two lines.
- `order_items` gains `variant_id` null, `variant_label` null (e.g. "Size: M / Color: Red"), and its `sku` is the variant's sku. Credit memos restock the variant. Orders, invoices, emails, and the customer's order page show the variant label.

## 4. Mass actions on the product grid

- `POST /products/bulk` `{ ids: [1..200 ids], action, value? }`:
  - `enable` (status active), `disable` (draft), `archive` — `products.edit`
  - `delete` — `products.delete`
  - `set_category` `{ value: category_id }` — `products.edit`
  - `adjust_price` `{ value: { mode: "percent"|"fixed", amount } }` (amount may be negative; a result below 0.01 is a 422 naming the products) — `products.edit`
  - `set_stock` `{ value: integer >= 0 }` (products without variants only; others are skipped and listed) — `products.edit`
- All or nothing in one transaction. The answer: `{ data: { updated: n, skipped: [{ id, reason }] } }`. One audit entry per product.

## 5. Import and export (CSV)

- New permission `products.import` (import and export).
- `GET /products/export.csv` with the same filters as the product list → columns `sku,name,category_slug,brand,price,discount_percent,stock_quantity,status,description,tags,image_urls` (tags and image URLs separated by `|`). Values starting with `= + - @` are prefixed with `'`.
- `POST /products/import` (multipart `file`, CSV, max 2 MB and 5,000 rows, UTF-8 with or without BOM, header row required, columns in any order; `sku` and `name` required, others optional) with `dry_run` (default true):
  - Matches existing products by `sku` (update) or creates new ones (`category_slug` then required; `status` defaults to `draft`).
  - Answer: `{ data: { dry_run, rows, created, updated, unchanged, errors: [{ row, column, message }] } }`. With any error, nothing is saved even when `dry_run` is false.
  - `image_urls` on import only accepts `https://` URLs and only adds images the product doesn't already have.
  - One audit entry per import (`product.imported`) with counts, not one per row.

## 6. Product reviews with moderation

- `reviews` gains `status` (`pending|approved|rejected`, default `pending`), `title` null, `verified_purchase` bool, `updated_at`. Imported DummyJSON reviews become `approved`.
- Storefront (signed-in customers): `POST /api/v1/products/{id}/reviews` `{ rating 1-5, title (max 120, optional), comment (10 to 2000 chars) }`. One review per customer per product (422 `already_reviewed`). `verified_purchase` is true when the customer has a non-cancelled order with that product. Plain text only (HTML stripped). Rate-limited (10 per hour per customer).
- Public product pages show approved reviews only; `rating_average` and the review count are recomputed from approved reviews whenever a review's status changes.
- Setting `reviews.require_approval` (default true, Settings → Catalog). When false, new reviews are approved immediately.
- Admin: new permissions `reviews.view`, `reviews.moderate`. `GET /reviews?status&product_id&rating&search&page`, `PATCH /reviews/{id}` `{ status }`, `POST /reviews/bulk` `{ ids, status }`, `DELETE /reviews/{id}`. All audited.

## 7. Permissions and roles

New keys: `products.import`, `reviews.view`, `reviews.moderate` (Catalog group). The starter role **Catalog manager** gets all three; **Viewer** gets `reviews.view` (it already gets every `*.view`). Owner gets everything automatically.

## Browser-facing routes (sign-in service)

- Admin: `/api/admin/categories…`, `/api/admin/products/{id}/images…` (multipart passed through, 60 MB request cap), `/api/admin/products/{id}/options`, `/variants…`, `/api/admin/products/bulk`, `/api/admin/products/export.csv` (headers passed through), `/api/admin/products/import` (multipart), `/api/admin/reviews…`.
- Store: `POST /api/shop/products/{id}/reviews` (customer cookie required).
- Media: `GET /media/products/{id}/{file}` streams Laravel's `/storage/products/...` with `Cache-Control: public, max-age=31536000, immutable`; only paths matching `^products/\d+/[a-f0-9]{32}\.(jpg|png|webp)$` are allowed (anything else 404). This keeps every image on the store's own origin, so the CSP doesn't need the API's address.

## UI

- **Admin**
  - **Categories page:** an indented tree with add child, edit (dialog), activate/deactivate, delete, and move up/down buttons (keyboard accessible; no drag-only controls).
  - **Product form:** an Images section (upload several files, preview, alt text, reorder, delete), and an Options and variants section (define options and values, generate combinations, a variant table with sku, price, stock, active).
  - **Products grid:** checkboxes with "select all on this page", and a bulk action bar showing the selected count, with a confirmation for delete and price changes.
  - **Import / Export page:** download CSV with the current filters; upload → dry-run report → "Import now".
  - **Reviews page:** filters, approve/reject/delete, bulk approve/reject.
  - Navigation entries appear only for roles with the matching permission.
- **Storefront** (real mode)
  - Category pages list subcategories and include their products.
  - The navigation shows top-level categories and their children.
  - The product page has option selectors (price, stock, and the add-to-cart button follow the selected variant; unavailable combinations are disabled), and the cart, checkout, and order pages show the variant label.
  - The product page has a review form for signed-in customers ("Thanks — your review will appear after approval"), and a "Verified purchase" badge on reviews.

## Tests

Backend feature tests for every rule above (tree cycles and depth, delete guards, descendant listing, invisible categories, upload type sniffing (a `.jpg` that is really a PHP or SVG file is rejected), image count limits, variant checkout and stock locking, restocking variants on refund, bulk all-or-nothing, import dry run and error rows, CSV injection, one review per customer, rating recomputation, permissions on every new route). Storefront and admin unit tests for the new UI, and a new browser suite `e2e/catalog.mjs`.

## Implementation notes (backend, 2026-11-16)

Where the contract left something open, the Laravel side chose the following. Paths are under `/api/admin/v1` (admin) or `/api/v1` (store).

**Categories**
- Admin tree item (GET `/categories`, and the `data` of POST/PATCH, which return that category with its subtree): `{ id, name, slug, parent_id, position, is_active, image_url, description, meta_title, meta_description, product_count, children: [...] }`. `product_count` = direct, not-deleted products. POST `/categories/reorder` answers the whole tree.
- POST: `name` required; `slug` optional (made from the name, `-2` if taken). New or moved categories go last among their siblings unless `position` is sent. `image_url` must start with `https://` or `/media/`.
- 422 fields: `parent_id` (cycle: "…can't be moved under itself or one of its subcategories."; depth: "…at most 3 levels deep."), `category` (delete guard; also refused while soft-deleted products still point at it, since they keep it for past orders), `ids.N` (reorder: not a child of `parent_id`).
- Public item (GET `/api/v1/categories`): `{ id, slug, name, image_url, description, meta_title, meta_description, parent_id, children }`. Only visible categories whose subtree has at least one product for sale.
- The admin product list's `category` filter stays an exact match (no descendants); the store's includes descendants.
- Audit actions: `category.created`, `category.updated`, `category.deleted`, `category.reordered`.

**Images**
- Image item (admin): `{ id, url, alt, position, is_upload }`. POST (201), PATCH, DELETE, and reorder all answer `{ data: [every image of the product, in order] }`. The store keeps `{ url, alt }`.
- Errors: a bad file → `images.N` ("name: Only JPEG, PNG, or WebP images can be uploaded." / "…isn't a valid image." / "…at most 6000×6000 pixels." / "Each image can be at most 5 MB."); count limits → `images`. One bad file refuses the whole request. Reorder needs every image id exactly once (else 422 `ids`). DELETE closes the gap (positions stay 0, 1, 2…).
- A file passes only when `finfo` and `getimagesize` agree on JPEG, PNG, or WebP (PHP 8.5's `getimagesize` also recognizes SVG, so the agreement matters). Files are not re-encoded (no GD here).
- The product form's `images` (URL list on POST/PATCH `/products`) still works: max 12 now, and it may list `/media/products/...` URLs of the product's own uploads to keep them; uploads left out are deleted with their files.
- The thumbnail follows the first image after any image change (upload, delete, reorder, URL list). `buynest:import-catalog` keeps uploaded images (it only replaces images with `path = null`) and follows the first image only when the product has uploads.
- Audit actions: `product.images_added`, `product.image_updated`, `product.image_deleted`, `product.images_reordered`.

**Options and variants**
- A product "has variants" when it has at least one option: new column `products.has_variants`. `PUT /options` with `[]` makes it simple again (its variants are deactivated).
- Options are matched by name and values by value (ignoring case) when replaced, so kept ones keep their ids and their variants stay valid. Errors: `options` (max 3), `options.N.name` (duplicate), `options.N.values` (1–20), `options.N.values.M` (duplicate).
- Admin product detail (GET/POST/PATCH `/products/{id}`, and the answer of PUT `/options`, POST `/variants/generate`, PATCH `/variants/{id}`) adds:
  - `options: [{ id, name, position, values: [{ id, value, position }] }]`
  - `variants: [{ id, sku, option_value_ids, label ("Size: M / Color: Red"), price (own price or null), effective_price, final_price (after the product's discount), stock_quantity, is_active, is_current (false once one of its values was removed), created_at, updated_at }]` (all variants, inactive included)
  - `category` gains `id`; every product (list and detail, admin and store) gains `has_variants` and `review_count`.
- `generate` answers the product with `meta: { created: n }`. SKUs are `Str::slug("{product_sku}-{value}-{value}")` **upper-cased** (e.g. `TEE-1-S-RED`), with `-2`, `-3` if taken. Limit: 200 variants per product (422 `options`). With no options: 422 `options`.
- PATCH variant: `price` null = the product's price, otherwise ≥ 0.01; switching on a variant whose values were removed → 422 `is_active`. SKUs are unique across products and variants (both directions; product SKU message unchanged: "Another product already has this SKU.").
- The product's `stock_quantity` is stored (kept equal to the sum of active variants' stock after every variant change, checkout, refund, and cancellation), so lists, filters, and low-stock reports work unchanged. PATCH `/products/{id}` ignores `stock_quantity` for a product with variants.
- Public product detail: `options: [{ id, name, values: [{ id, value }] }]`, `variants: [{ id, sku, option_value_ids, price, final_price, stock_quantity, in_stock }]` exactly as the contract says (active only; `price` is the effective unit price before the discount).
- Cart/checkout: `items[].variant_id` (nullable). Problems use the existing problem list: `{ product_id, variant_id, code, message }` with new codes `variant_required` ("Choose the options for {name}.") and `variant_unavailable` (inactive, another product's, removed values, or a variant id on a simple product). As before, `cart/validate` answers 200 with `problems` (the line is `available: false`, not charged) and `POST /orders` answers 422 with `problems`. Every line and problem now has `variant_id`; lines also `variant_label`; `sku` and `stock_quantity` are the variant's.
- `order_items` → `variant_id`, `variant_label` in order items (store and admin), invoices, credit memo items, and the refundable list. Emails show "Name (Size: M / Color: Red)". Cancelling an order also restocks the variant.
- Audit actions: `product.options_updated`, `product.variants_generated`, `product.variant_updated`.

**Mass actions**
- `ids`: 1–200 distinct; any id not found (or deleted) → 422 `ids` naming them, nothing changes. `adjust_price.value.amount` ≠ 0; percent result rounded to the cent (halves up). Variants with their own price are adjusted the same way. Results below 0.01 or above 1,000,000 → 422 `value.amount` naming the products ("Name (SKU)").
- The route checks `products.edit`; `delete` additionally needs `products.delete` (same 403 `permission_denied` body with `permission: "products.delete"`).
- `updated` = products processed (all but `skipped`); audit entries (`product.updated` / `product.deleted`, summary ends "(bulk action)") are written only for products that actually changed.

**Import / export**
- Export filename `products-YYYY-MM-DD.csv`; uploaded images export as `/media/...` URLs (import skips URLs the product already has, so an export imports back without errors).
- Import: `dry_run` accepts `1/0/true/false` (default true). Row numbers count the header as row 1. Column names are case-insensitive. An empty cell means "leave as it is". New products also need `price` (the contract only says `category_slug`; a product can't exist without a price) and start with stock 0, discount 0, status `draft` unless given.
- Errors `{ row, column, message }`; `column` is null for whole-row problems. Header problems (unknown or duplicate column, missing `sku`/`name`) are row 1. Row errors still answer 200 (with the would-be counts) so the report can be shown. Problems with the file itself answer **422 on `file`**: over 2 MB, not UTF-8, empty, header only, more than 5,000 rows.
- The audit entry `product.imported` (subject `product`, no id) has `changes.after = { rows, created, updated, unchanged }`; nothing is written on a dry run.
- Cells are not un-escaped: a value exported as `'=1+1` imports back as `'=1+1`.

**Reviews**
- Setting key: `reviews_require_approval` in a new settings group `catalog` (PATCH `/settings` `{ catalog: { reviews_require_approval: false } }`; a dot can't be part of a key there).
- Public review item: `{ id, rating, title, comment, created_at, author_name, verified_purchase }`. POST `/products/{id}/reviews` → 201 with that plus `status`. `author_name` = first name + last initial ("Nadia R."). 422 `already_reviewed`: `{ message, code: "already_reviewed", errors: { product: [...] } }`. Product not for sale → 404. Rate limit: 10 per hour per customer (429). HTML is stripped before the lengths are checked.
- Admin review item: `{ id, status, rating, title, comment, author_name, verified_purchase, product: { id, name, sku, thumbnail_url } | null, customer: { id, name, email } | null, created_at, updated_at }`. GET `/reviews` is a normal paginated list (newest first) with extra `meta.counts: { pending, approved, rejected }` (all reviews, ignoring filters). `search` matches comment, title, author name, product name or SKU. PATCH answers the item; bulk answers `{ data: { updated } }` (reviews whose status really changed; any unknown id → 422 `ids`, nothing changes); DELETE → 204.
- `rating_average` = the average of approved reviews (2 decimals, `0.00` with none) and `review_count` (new column) are recomputed when a review is approved, leaves "approved", is deleted while approved, or is created already approved. Imported products keep DummyJSON's rating until one of their reviews changes.
- Audit actions: `review.approved`, `review.rejected`, `review.pending`, `review.deleted`.

**Permissions**
- Migration `2026_11_16_000400_grant_phase5_permissions` adds the new keys to existing non-system roles named "Catalog manager" and "Viewer" (already applied to the dev database).

# Phase 23 contract: My reviews

**Status: built (2026-11-28).** The owner chose "My reviews page" from the next-step options, so Q1–Q4 below are built with the proposed answers. Changes made while building: the customer's email in the audit sits in `changes.before.customer_email` (the audit page shows only before/after); `photos_note` is one top-level key of the export; focus after a photo delete goes to that card's heading; after any delete every loaded page is fetched again so "Show more reviews" never skips one; see [SQA_REPORT.md](../SQA_REPORT.md) "Phase 23". The owner can still change any answer.

Today a customer who writes a review never sees it again, unless it is published. They can't tell whether it is waiting for approval, can't remove a photo they regret, and can't delete the review. On the product page they only learn they already reviewed it after filling in the form again. This phase adds **My account → My reviews**.

## Decisions for the owner (proposed; building with these)

| # | Question | Proposed |
|---|---|---|
| Q1 | Can customers delete their own review? | **Yes, at any time.** Reward points already earned stay. Writing a new review of the same product never earns the review bonus twice (phase 11 already allows it only once per customer and product) |
| Q2 | Can they edit a review? | **Not in this phase.** They can delete it and write a new one, which waits for approval like any new review |
| Q3 | Do they see a rejected review? | **Yes, as "Not published"** (no reason: staff don't record one). It can be deleted, and then a new review can be written |
| Q4 | Do they see a photo that staff hid? | **Yes, to the author only, labelled "Hidden by the shop".** They can delete it |

## Ground rules (every builder)

- Only BuyNest's own API (the `REAL_SHOP` / Laravel mode). The DummyJSON demo mode is unchanged: no account reviews there.
- **A customer sees and changes only their own reviews.** Another customer's review, or a photo of it, always answers **404**, never 403, so it doesn't reveal that the review exists.
- **Photos stay private.** The author can see their own photos in every status through a customer-only address with `Cache-Control: private, no-store`. Public photo addresses are unchanged (phase 22).
- Keep the store honest: the product's rating and review count follow approved reviews only (`Reviews::refresh`).
- No real outside calls. The usual safety rules apply:
  - never read or edit `.env` / `.env.local`;
  - agents never run state-changing git commands;
  - no 0-byte files;
  - never change or delete `admin@buynest.test`, `customer@buynest.test` (Ava) or `shopper2@buynest.test` (Ben);
  - never turn on two-step sign-in.
- Use the project's PHP and Node (`export PATH="/var/www/Buynest/.tools/bin:$PATH"`) and run artisan with `env -u AI_AGENT`. On the shared dev database run only forward `migrate` (never `fresh`, `refresh` or `rollback`).
- Only the lead runs browser suites.
- Storefront texts are in English and Bangla (`docs/I18N.md` for new words).

## 1. Backend (Laravel): customer token, `auth:sanctum` + `token.kind:customer`, like the other `me/*` routes

### `GET /api/v1/me/reviews?page&per_page&product_id`

- Returns this customer's reviews, newest first, 10 per page by default (at most 50), in Laravel's normal paginated shape (`data`, `meta`, `links`). `product_id` filters to one product, which the product page uses.
- Each item:
  ```
  { id, status: pending|approved|rejected, rating, title, comment, created_at, verified_purchase,
    product: { id, name, thumbnail_url, available: bool } | null,
    photos: [{ id, url: '/api/shop/me/reviews/{id}/photos/{photoId}', width, height, hidden, position }] }
  ```
- `product.available` is false when the product is deleted or not for sale; the storefront then shows the name without a link.
- `product.name` is translated like the catalog's (the request's `Accept-Language`).
- `photos.url` is the **storefront** address: the BFF serves it, and Laravel only gives the path shape. Build it in the resource exactly as above.

### `GET /api/v1/me/reviews/{id}/photos/{photo}`

- The bytes of the author's own photo in every status, hidden included.
- Headers: `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, and `Content-Type` from the extension.
- Reuse the phase 22 `photoResponse()`.
- 404 when the review isn't this customer's or the photo isn't that review's.

### `DELETE /api/v1/me/reviews/{id}`

- Returns 204.
- Goes through `Reviews::delete()`: the files are deleted after commit and the product's stats are refreshed when the review was approved.
- Audit: `review.deleted_by_customer`, "Review #41 on product SKU deleted by its author." The admin is null; the customer's email goes in the context.
- 404 when not theirs.

### `DELETE /api/v1/me/reviews/{id}/photos/{photo}`

- Returns `{ data: review item }`.
- Deletes the row, and the file after commit. The remaining photos are renumbered (positions 0, 1, …).
- Audit: `review.photo_deleted_by_customer`.
- The review keeps its status, because removing content needs no new approval.
- 404 when not theirs.

### Export (`GET /api/v1/me/export`)

- Each review gains `photos: [{ width, height, hidden, added_at }]`. The file itself isn't included, and the JSON adds a note: `photos_note: "Your review photos can be seen and downloaded in My account → My reviews."`.

### Rate limits

- `me/reviews` reads use the normal API limit. Deletes use `throttle:reviews`, as writing does.

### Tests: `tests/Feature/MyReviewsTest.php`

- The list shows only this customer's reviews, in every status, newest first. Pagination and `product_id` work.
- A deleted product → `available: false`.
- Photo URLs have the storefront shape. Hidden photos are listed with `hidden: true`.
- Own photo bytes in a pending review → 200 with `no-store`. Another customer's → 404.
- Delete an approved review: 204, files gone, product stats refreshed, audited. Another customer's → 404. Writing again afterwards works, and the review bonus is not given twice (rewards on, bonus > 0).
- Delete a photo: renumbered, file gone, status unchanged, audited. Another customer's → 404.
- Export: `photos` and `photos_note`.
- Staff tokens are refused, as on the other `me/*` routes.

## 2. Storefront and its sign-in service (BFF)

### BFF (`frontend/server/shopApi.js` + `shop/laravel.js`, customer session as for `me/stock-alerts`)

| Route | Answer |
|---|---|
| `GET /api/shop/me/reviews?page&productId` | `{ reviews: [...], page, pages, total }` |
| `GET /api/shop/me/reviews/:id/photos/:photoId` | Streams the bytes, `image/jpeg|png|webp` only, at most 10 MB, `private, no-store`, nosniff, sandbox CSP. Without a session → 401 |
| `DELETE /api/shop/me/reviews/:id` | `{ deleted: true }` |
| `DELETE /api/shop/me/reviews/:id/photos/:photoId` | `{ review }` |

- Each review is mapped through an **allow-list**:
  - `{ id, status, rating, title, comment, date, verifiedPurchase, product: { id, name, thumbnail, available } | null, photos: [{ id, url, width, height, hidden }] }`;
  - a photo URL is kept only when it matches `^/api/shop/me/reviews/\d+/photos/\d+$`;
  - status falls back to `pending`.
- Proxy tests: `server/api.phase23.test.js`.

### Page `/account/reviews` (`ROUTES.myReviews`), "My reviews" in the account menu after "Stock alerts" (REAL_SHOP only)

- **Heading** "My reviews". While loading, a skeleton.
- **Empty state:** "You haven't written any reviews yet." plus a link "Browse products".
- **Each review is a card:**
  - the product thumbnail and name, linked when `available`, otherwise the name and "No longer available";
  - the stars, with an accessible name such as "4 out of 5 stars";
  - the date, the title and the text;
  - a status badge (text, not colour alone): "Waiting for approval", "Published" or "Not published";
  - photos as thumbnails, 72 px, using the owner URLs. A hidden one is dimmed and labelled "Hidden by the shop". Each thumbnail opens the phase 22 viewer (`ReviewPhotoViewer`), reused.
- **"Delete photo N" button** under each photo (accessible name "Delete photo 2 of your review of {product}"). It asks first in a confirm dialog: title "Delete this photo?", buttons "Delete photo" / "Keep it".
- **"Delete review" button** (accessible name "Delete your review of {product}"). Confirm dialog: title "Delete your review?", text "Your review of {product} will be removed from the store. This can't be undone.", buttons "Delete review" / "Keep it".
- **After a delete:**
  - a polite status message: "Your review was deleted." / "The photo was deleted.";
  - focus moves to the next card's heading (or the page heading when none is left);
  - the product's detail query is invalidated so the store page updates.
- **Pagination:** "Show more reviews" (loads the next page and appends; keeps focus sensible) when `page < pages`.
- **Errors:** a load error shows a message with "Try again". A delete error is shown in the dialog.
- **Product page `ReviewForm`:** when signed in, it first asks `GET /api/shop/me/reviews?productId=X`.
  - If the customer already has a review of this product, the form is replaced by: "You've already reviewed this product. See it in My reviews." (a link to `/account/reviews`), plus the status badge.
  - While that request runs, or if it fails, the form shows as today; the server still refuses a second review.
- **The account page / menu:** add the link wherever "Stock alerts" and "Reward points" are listed (account sidebar / dashboard).
- Every text in English and Bangla. Works at 390 px, keyboard and screen reader friendly, axe-clean. Colours come from the tokens only, with contrast ≥ 4.5:1.

### Tests (vitest)

- The page: list, empty state, statuses, an unavailable product, hidden photo label, both delete flows (dialog, API call, message, focus), show more, the load error with retry.
- `ReviewForm`: the "already reviewed" link replaces the form.
- The menu link exists only in REAL_SHOP.
- The Bangla texts exist.

## 3. Browser suite `e2e/my-reviews.mjs` (added to `run-all.mjs` after `review-photos`)

It records the settings it changes (`catalog.reviews_require_approval`, `catalog.review_photos_enabled`) and restores them in `finally`. It creates its own two products through the admin API and deletes them in `finally` (reviews first). Ava writes the reviews (only on the suite's own products).

1. Ava, My reviews, with none on the suite's products. The page loads, the menu link is there, axe passes.
2. Ava writes review A on product 1 with 2 photos (photos switched on) and review B on product 2 without photos, with approval required.
   - My reviews lists both as "Waiting for approval".
   - A's thumbnails load (naturalWidth > 0) through the owner URL, which answers `no-store`.
   - Ben, signed in, gets 404 for the same photo URL, and the API answers 404 to Ben's DELETE of A.
3. Product 1's page shows "You've already reviewed this product" with a link to My reviews, instead of the form.
4. Admin approves A, rejects B, and hides A's photo 2. My reviews then shows:
   - A "Published", with photo 2 "Hidden by the shop";
   - B "Not published".
5. Ava deletes A's photo 2 through the dialog:
   - "Keep it" first changes nothing;
   - then "Delete photo": "The photo was deleted." and 1 photo left;
   - its owner URL now answers 404.
6. Ava deletes review A:
   - the message appears and the card is gone;
   - product 1's public page no longer lists it, and its review count went back down;
   - the remaining photo's public URL gives 404.
7. Product 1's page shows the review form again. Ava can write a new review (no photos), and it is "Waiting for approval".
8. Bangla: the page heading and status badges are in Bangla. 390 px: no sideways scroll. axe passes with a dialog open.
9. Export (API): the reviews have `photos` and `photos_note`.
10. Clean-up: Ava's reviews on the suite's products, both products, the settings. Then no page errors.

## 4. Docs

- README progress row **B27**.
- SQA_REPORT "Phase 23" (problems found and fixes, check counts).
- LEARNING_LOG entry (404 not 403 for other people's things; a private photo address).
- `docs/I18N.md` new words.
- This contract marked built.

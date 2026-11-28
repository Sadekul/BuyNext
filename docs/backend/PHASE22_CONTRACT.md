# Phase 22 contract: product reviews with photos

**Status: built (2026-11-28)** with the proposed answers to Q1–Q5 below. Changes made while building: a one-photo form of the pending message, a 6000 × 6000 pixel limit message, the product and store-info fields mapped in the storefront's adapters (the catalog proxy passes Laravel's data through), the admin filter as a *Photos* select (Any / With photos), and imported demo reviews marked so a re-import keeps erased customers' reviews; see [SQA_REPORT.md](../SQA_REPORT.md) "Phase 22". The owner said "you should start next steps"; this was the first idea on CLAUDE.md's "Ideas not started yet" list that needs none of the owner's outside accounts. The owner can still change any answer.

Shoppers in Bangladesh trust photos from other buyers more than product photos ("is the colour real?", "is the size right?"). This phase lets a signed-in customer add up to three photos to a review. Staff see them before anyone else does, and can hide a single photo without rejecting the whole review.

## Decisions for the owner (proposed; building with these)

| # | Question | Proposed |
|---|---|---|
| Q1 | How many photos per review | **Up to 3**, each at most 5 MB (JPEG, PNG or WebP) |
| Q2 | Do reviews with photos wait for a moderator even when Settings → Catalog publishes reviews straight away? | **Yes, always.** A photo can show anything (faces, addresses on parcels). Reviews without photos follow the existing setting |
| Q3 | On or off at first | **Off.** New setting **Settings → Catalog → "Customers can add photos to reviews"**. Nothing changes until it is ticked |
| Q4 | Privacy | Photos are **always** cleaned before they are stored: location (GPS), camera and other hidden data are removed, and the photo is shrunk to at most 1600 pixels on its longest side. The browser shrinks it before upload (less mobile data), and the server does it again, because a browser can be bypassed |
| Q5 | Extra reward points for a review with photos | **No.** The same review bonus as any review (phase 11). It could be added later |

## Ground rules (every builder)

- **Feature off by default** (`review_photos_enabled = false`). While it is off, every existing answer, page and browser suite is unchanged, and the photo field is refused (below).
- **Photos are private until approved.** They are stored on Laravel's private `local` disk, never on the `public` disk, so `/storage/...` can never serve them. The public can only get them through an endpoint that checks that the review is approved and the photo is not hidden. This differs from product photos, which are public by design.
- **Never trust the file:** the type comes from the bytes (`App\Support\ImageSniffer`: JPEG, PNG and WebP only). The stored name is chosen by the server (`{32 random hex}.{ext}`), never the uploader's.
- **Short browser cache for review photos** (`Cache-Control: public, max-age=300`, never `immutable`). A photo that staff hide must disappear from the store within minutes. Product photos keep their one-year cache.
- **Honest store data:** only approved reviews and visible photos are counted or shown. "With photos (n)" counts what the visitor can actually see.
- No real outside calls. The usual safety rules apply:
  - never read or edit `.env` / `.env.local`;
  - agents never run state-changing git commands;
  - no 0-byte files;
  - never change or delete `admin@buynest.test`, `customer@buynest.test` (Ava) or `shopper2@buynest.test` (Ben);
  - never turn on two-step sign-in.
- Use the project's PHP and Node (`export PATH="/var/www/Buynest/.tools/bin:$PATH"`) and run artisan with `env -u AI_AGENT`. On the shared dev database run only forward `migrate` (never `fresh`, `refresh` or `rollback`).
- Only the lead runs browser suites, one at a time.
- The storefront is in English and Bangla. Every new storefront text has a Bangla version (drafted, for the owner's review in `docs/I18N.md`). The admin is English only.

## 1. Backend (Laravel)

### Data: migration `2026_11_29_000100_add_review_photos`

- New table `review_photos`:
  - `id`;
  - `review_id` (fk reviews, cascade on delete);
  - `name` (string 40, unique: `{32 hex}.{jpg|png|webp}`);
  - `path` (string 190: `review-photos/{review_id}/{name}` on the `local` disk);
  - `width` and `height` (unsigned small int);
  - `size_bytes` (unsigned int);
  - `position` (unsigned tiny int, 0 to 2);
  - `hidden` (bool, default false);
  - timestamps.
- Model `ReviewPhoto` (`belongsTo` Review); `Review::photos()` (`hasMany`, ordered by position).
- `Review::MAX_PHOTOS = 3`, `ReviewPhoto::MAX_KILOBYTES = 5120`, `ReviewPhoto::MAX_SIDE = 1600`.
- **Files follow their rows.** Deleting a review (staff, or `Reviews::delete()`) deletes its photo files after the transaction commits (`DB::afterCommit`). A failed upload deletes any files it already wrote.
- **Erased customers:** check what erasing a customer's account does to their reviews (`CustomerAccounts` / the erase flow). If reviews are kept, anonymised, their photos (rows and files) are deleted, because a photo can identify a person. Test this.

### Setting

- `review_photos_enabled` (bool, default `false`) in the `catalog` group, next to `reviews_require_approval`. It is part of `GET/PATCH /api/admin/v1/settings` as `catalog.review_photos_enabled`.
- The public store info `GET /api/v1/store` adds `review_photos: { enabled: bool, max: 3, max_megabytes: 5 }`, so the storefront knows whether to show the photo field.

### Cleaning a photo: `App\Services\ReviewPhotoProcessor`

- `process(string $tmpPath, string $ext): array{bytes, ext, width, height}`.
- **With GD** (this computer's PHP and the production image both have it): decode the photo and apply the JPEG orientation flag (as `ImageResizer` does). Then scale down so the longest side is ≤ 1600 px (never up) and re-encode in the same format: JPEG quality 82, PNG level 9 with transparency kept, WebP quality 80. Re-encoding drops all hidden data.
- **Without GD** (fallback): `App\Support\ImageMetadata::strip(bytes, ext)`, pure PHP, which keeps the pixels but removes the hidden data:
  - JPEG: drop APP1 (EXIF/XMP), APP13 (IPTC) and COM segments; keep APP0, APP2 (ICC colour profile) and everything else.
  - PNG: drop `eXIf`, `tEXt`, `zTXt`, `iTXt` and `tIME` chunks.
  - WebP: drop `EXIF` and `XMP ` chunks, clear the EXIF/XMP flag bits in `VP8X`, and fix the RIFF size.
  - Unit-tested with crafted bytes that contain a GPS marker.
- `strip()` is also run on the GD output, as a belt-and-braces step. A test proves a JPEG with an EXIF GPS block comes out without the bytes `Exif` and `GPS`, on both paths: GD, and forced fallback via a constructor flag or a small seam.
- Decoding problems give a 422 for that file, never a 500.

### Customer API

`POST /api/v1/products/{id}/reviews` (existing; customer token; `throttle:reviews`) also accepts **multipart/form-data**: `rating`, `title`, `comment`, and `photos[]` with 0 to 3 files. JSON requests work exactly as today.

- `photos` sent while the setting is off → 422 `{ code: 'photos_disabled', errors: { photos: ['Photos can't be added to reviews.'] } }`.
- Validation messages (`__()`, so they can be translated):
  - more than 3 → "Add at most 3 photos.";
  - a file over 5 MB → "Each photo can be at most 5 MB.";
  - the wrong type → "Only JPEG, PNG or WebP photos can be added." (`photos.{i}`);
  - an image that can't be read → "This photo couldn't be read." (`photos.{i}`).
- **All or nothing.** Every file is sniffed and processed **before** the review row is written. Files are written in the transaction, and any file written is deleted if the transaction fails.
- **Status:** a review **with** photos is always `pending` (Q2), and the reward bonus waits for approval as it does today. A review without photos follows `reviews_require_approval` as today.
- **The answer:** 201 `{ data: { ...publicReview, status, photos: [{ id, url, width, height }] } }`. The URLs are shown to the author in the success message only as a count, so a pending review's URLs simply don't load for anyone (404).

### Serving photos

- **Public:** `GET /api/v1/review-photos/{name}`, where `name` matches `^[a-f0-9]{32}\.(jpg|png|webp)$` (else 404).
  - Returns 200 with the bytes only when the photo is not hidden, its review is `approved`, and the review's product is not deleted. Otherwise 404, with the same answer for "doesn't exist" and "not public".
  - Headers:
    - `Content-Type` from the extension;
    - `Cache-Control: public, max-age=300`;
    - `X-Content-Type-Options: nosniff`;
    - `Content-Security-Policy: default-src 'none'; sandbox`.
  - Normal API throttle.
- **Staff:** `GET /api/admin/v1/reviews/{id}/photos/{photo}` (`reviews.view`) returns the bytes in every status, with `Cache-Control: private, no-store` and the same safety headers. 404 when the photo is not this review's.
- **Public review shape** (`ProductResource::publicReview`) gains `photos: [{ id, url: '/media/reviews/{name}', width, height }]`: visible photos only, in order, and `[]` when none. The product detail eager-loads `reviews.photos`.
- **Product detail** gains `review_photo_count` (visible photos on approved reviews), for "With photos".

### Admin API (moderation)

- The review item (`Admin\ReviewController::item`) gains `photos: [{ id, hidden, width, height, size_bytes, position }]`.
- `GET reviews` gains the filter `has_photos=1` (reviews with at least one photo, hidden or not).
- `PATCH /api/admin/v1/reviews/{id}/photos/{photo}` `{ hidden: bool }` (`reviews.moderate`) returns `{ data: review item }`.
  - Audit `review.photo_hidden` / `review.photo_shown` ("Photo 2 of review #41 on product SKU hidden.").
  - No audit when nothing changed. 404 when the photo is not this review's.
- `DELETE reviews/{id}` also removes the photo files, after commit.

### Tests (`tests/Feature/ReviewPhotosTest.php` and a unit test for `ImageMetadata`)

Use `Storage::fake('local')` and real tiny images made in the test: PNG made with GD, and a JPEG with a crafted EXIF GPS segment spliced in. The tests cover:

- setting off → 422 `photos_disabled`, and JSON reviews unchanged;
- setting on → 1 to 3 photos stored, review `pending` even when require_approval is off, files are on the `local` disk only;
- 4 photos → 422; over 5 MB → 422; a text file renamed .jpg → 422; nothing is stored on any 422 (row count and files);
- the GPS data is removed (GD path and fallback path); a 3000 px photo becomes 1600 px;
- public endpoint: pending → 404, approved → 200 with the headers, hidden → 404, rejected → 404, bad name → 404, product deleted → 404;
- the public review shape lists only visible photos; `review_photo_count` is right;
- admin: the item has photos; `has_photos` filter; hide/show is audited (and not audited when unchanged); the staff photo endpoint works in every status and needs `reviews.view`; another review's photo → 404;
- deleting a review deletes its files; the erased-customer rule;
- settings exact JSON gains the new key; the store info gains `review_photos`.

## 2. Storefront and its sign-in service (BFF)

### BFF (`frontend/server`)

- `POST /api/shop/products/:id/reviews`:
  - A multipart request is passed through **unparsed** to Laravel, capped at **16 MB** (3 × 5 MB plus framing). Reuse `multipartType` / `readLimitedBody` from `http.js`, as the admin image upload does. Over the cap → 413-style 422 with `photos: ['The photos are too large together (at most 16 MB).']`.
  - JSON works exactly as today.
- `fromReview` (`shop/laravel.js`) gains `photos: [{ id, url, width, height }]`, through an **allow-list**: a URL is kept only if it matches `^/media/reviews/[a-f0-9]{32}\.(jpg|png|webp)$`; anything else is dropped. Width and height are positive integers or null. The product mapping gains `reviewPhotoCount` (integer ≥ 0, default 0). Add a proxy test for each new field (the phase 17 lesson).
- The store info mapping gains `reviewPhotos: { enabled, max, maxMegabytes }`, which defaults to `{ enabled: false, max: 3, maxMegabytes: 5 }` when absent.
- `mediaApi.js`: the allow-list also accepts `reviews/<32 hex>.<jpg|png|webp>`, which is fetched from `${laravel}/api/v1/review-photos/<name>`.
  - Review photos are answered with `Cache-Control: public, max-age=300` (product photos keep the year).
  - Laravel's 404 stays a 404.
  - Tests cover the new path, the short cache, and the rejection of `reviews/../x`, `reviews/<hex>.svg` and `reviews/<hex>-320.webp`.
  - The same module serves Vercel and Netlify, so no other file needs a change, but check `vercel.json` / `netlify` rewrites already cover `/media/*`.

### ReviewForm (`components/product/ReviewForm.jsx`)

Shown only when the store info says `reviewPhotos.enabled`:

- **The field:** "Add photos (optional)". A visible button that opens a file input (`accept="image/jpeg,image/png,image/webp"`, `multiple`), with the hint "Up to 3 photos, JPEG, PNG or WebP, 5 MB each."
- **Previews:** chosen photos appear as small previews (object URLs, revoked on removal and unmount). Each has a "Remove photo 1" button.
- **Checks in the browser before sending:**
  - more than 3 → "You can add up to 3 photos.";
  - the wrong type → "{name} isn't a JPEG, PNG or WebP photo.";
  - over 5 MB *after shrinking* → "{name} is larger than 5 MB.".
- **Shrinking (`utils/shrinkPhoto.js`):**
  - `createImageBitmap(file, { imageOrientation: 'from-image' })` → canvas, longest side ≤ 1600 → `canvas.toBlob('image/jpeg', 0.85)`.
  - PNGs with transparency may stay PNG; simplest is to keep a PNG's type when the original is PNG.
  - If anything fails (old browser, decode error), the original file is sent and the server cleans it.
- **Sending:** with at least one photo, `submitReview` sends `FormData` (`rating`, `title`, `comment`, `photos[]`). Without photos, JSON as today.
- **The pending message:** with photos, the existing "will appear after approval" message is used, now with "Your photos will be checked first." added.
- **Server errors:** `photos` / `photos.N` errors are shown under the photo field, linked with `aria-describedby`.

### ProductReviews (`components/product/ProductReviews.jsx`)

- A review with photos shows them as thumbnails under its text: 72 px squares, `object-fit: cover`, `loading="lazy"`, real `width`/`height`.
  - Each thumbnail is a `<button>` with an accessible name: "Open photo 1 of 2 from Nadia R.'s review".
  - The image's `alt` is empty inside the button, because the button names it.
- **The viewer:** a `<dialog>` shows the photo large (fits 390 px wide screens and high-zoom).
  - It has "Previous photo" / "Next photo" buttons (hidden when there is a single photo), "Photo 1 of 2" as text, and a "Close" button.
  - Escape closes it, focus returns to the thumbnail that opened it, and the arrow keys move between photos.
  - Reduced motion: no animation.
- **"With photos" filter:** when `reviewPhotoCount > 0`, a toggle button above the list, "With photos (n)" with `aria-pressed`, shows only reviews with photos. n is the number of reviews with photos (computed from the list), not photos.
- A 404 photo (hidden after the page loaded) is hidden quietly (`onError`), never a broken image icon.
- Every text in `catalog` English and Bangla (`docs/I18N.md`). Colours come from the tokens only, and contrast is ≥ 4.5:1.

### Tests (vitest)

- `api.phase22.test.js`: multipart pass-through and its cap; the JSON path is unchanged; the `fromReview` photo allow-list; `reviewPhotoCount`; the store info default; the media paths.
- Component tests:
  - the field is hidden when the setting is off;
  - the type, count and size checks;
  - FormData is sent with photos and JSON without them;
  - server `photos.1` errors are shown;
  - previews can be removed;
  - thumbnails, the viewer (open, next, Escape returns focus);
  - the filter;
  - the Bangla texts exist.

## 3. Admin (+ its BFF routes)

### Admin BFF (`frontend/server/adminCatalogApi.js` and `shop/adminCatalog.js`)

- The review mapping gains `photos: [{ id, hidden, width, height, sizeBytes, position, url: '/api/admin/reviews/{id}/photos/{photoId}' }]` (ids are integers; anything else is dropped).
- The list filter `hasPhotos` (true → `has_photos=1`).
- `GET /api/admin/reviews/:id/photos/:photoId` streams Laravel's bytes. It needs the admin session and passes through only the `image/jpeg|png|webp` types. It sends `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; sandbox`, and is limited to 10 MB.
- `PATCH /api/admin/reviews/:id/photos/:photoId` `{ hidden }` → `{ review }`.
- Settings mapping (`shop/adminSystem.js`): `catalog.review_photos_enabled` ↔ `reviewPhotosEnabled`.
- Proxy tests for every new field and route.

### Reviews page (`admin/src/pages/ReviewsPage.jsx`)

- Each review shows its photos as thumbnails, loaded from the admin BFF URL.
  - A hidden photo is dimmed and labelled "Hidden from the store".
  - Each photo has a "Hide photo" / "Show photo" button (`reviews.moderate` only), with the accessible name "Hide photo 2 of review by Nadia R.".
  - Clicking a thumbnail opens it larger in a dialog.
- A "With photos" filter (checkbox or select option) next to the existing status filter.
- **Settings → Catalog:** a checkbox "Customers can add photos to reviews", with the help text "Reviews with photos always wait for approval. Photos are shrunk and their location data is removed."
- **Tests:** thumbnails render; hide/show calls the API and updates; the filter is sent; the settings checkbox is saved; hide is not shown without `reviews.moderate`.

## 4. Browser suite `e2e/review-photos.mjs` (added to `run-all.mjs` after `reports`)

The suite runs against the normal dev servers. It records the settings it changes (`catalog.reviews_require_approval`, `catalog.review_photos_enabled`) and **restores them in `finally`**. It creates its own product through the admin API and deletes it in `finally`, deleting its reviews first.

Fixtures are made in the suite: PNGs via `page.screenshot()` of a coloured box, and a JPEG via `page.screenshot({ type: 'jpeg' })` with an EXIF APP1 segment containing `GPS` spliced in after SOI.

1. Setting off: Ava sees the review form on the product without the photo field.
2. Admin ticks the setting in Settings → Catalog (through the UI). Reviews publish straight away (`reviews_require_approval` off) to prove Q2.
3. Ava (storefront sign-in helper) writes a 4-star review on the suite's product:
   - Adding 4 photos shows "up to 3".
   - A text file named `.jpg` is refused in the browser.
   - With 2 PNGs plus the GPS JPEG (3 photos) the form shows previews; she removes one, then sends with 2 photos.
   - The pending message mentions the photo check.
   - axe on the form with previews.
4. The photo URLs (from the admin API answer) give a public 404 while pending.
5. Admin, Reviews page, "With photos" filter:
   - The review shows 2 thumbnails that load (naturalWidth > 0).
   - Approve.
   - Hide photo 2 → "Hidden from the store".
6. Storefront product page (a fresh load):
   - The review shows **1** thumbnail.
   - The viewer opens, shows "Photo 1 of 1", Escape closes it and focus returns to the thumbnail.
   - "With photos (1)" filters the list.
   - The hidden photo's public URL gives 404; the visible one gives 200 with `max-age=300` and its bytes contain neither `Exif` nor `GPS`.
   - axe on the page and the open viewer; no sideways scroll at 390 px with the viewer open.
7. Bangla (`buynest_lang=bn`): the photo field label and the filter button are in Bangla.
8. Admin shows photo 2 again; the storefront then shows 2 thumbnails (after the 5-minute cache: check the API answer, not the image cache).
9. Clean-up (in `finally`): delete the review (its files go too), the product, and restore both settings. Then check that the deleted review's photo URL gives 404.

## 5. Docs

- README progress row **B26**.
- SQA_REPORT section "Phase 22" (problems found and fixes, check counts).
- LEARNING_LOG entry (why photos are private until approved, metadata stripping, the short cache).
- `docs/I18N.md` new Bangla words.
- This contract marked built.
- CLAUDE.md "Ideas" list updated.

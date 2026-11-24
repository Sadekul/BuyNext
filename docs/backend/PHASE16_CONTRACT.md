# Phase 16 contract: configurable products like Magento's product page

**Status: built (2026-11-24).** Asked by the user: "add configurable product: one product with different colors or sizes, electronic products with different configurations; the shopper selects the specific product before buying; follow Magento's product page."

Builds on phase 5 (options, variants, variant cart lines, variant order items and restocking — `docs/backend/PHASE5_CONTRACT.md` §3 and its implementation notes) and phase 13 (option/value `translations`). Keeps every convention (`snake_case`, money as 2-decimal strings in the store currency, `{ data }`, 422 by path, `can.admin:<key>`, audit entries, the BFF in front of every browser call, English + Bangla for all shopper-facing text, DummyJSON demo mode working). **Products without options behave exactly as today**, so every existing test and suite keeps passing.

## 1. Option types and swatches (data)

- `product_options.type`: `text` (default; today's buttons — Size, Storage, RAM) | `color` (round colour swatches). Optional `product_options.code` is not needed.
- `product_option_values.swatch`: for `color` options a hex colour `#RRGGBB` (required for color options when saved through the admin; values without one show a neutral swatch with the name), null for text.
- Admin `PUT /products/{id}/options` accepts `{ options: [{ name, type?, values: [{ value, swatch? } | "value"] }] }` (plain strings still work). Product detail (admin and public) returns `options: [{ id, name, type, values: [{ id, value, swatch }] }]` (Bangla per field as in phase 13).

## 2. Photos per choice

- `product_images.option_value_id` (nullable FK to `product_option_values`, null = shown for every choice). Admin: in the Images section each image gets a "Shown for" select (All / each value of the product's **color** option, or of its first option when there is no color option). `PATCH /products/{id}/images/{imageId}` accepts `option_value_id` (must belong to this product; 422 otherwise). Deleting a value sets its images back to null.
- Public product detail images gain `option_value_id`. Storefront: once the shopper picks a value that has its own images, the gallery shows those images first (then the shared ones) and moves to the first of them; with no such images the gallery is unchanged.

## 3. Product page (storefront) — Magento behaviour

- Each option is a fieldset whose legend shows the name and the **selected value** ("Color: Blue", "রং: নীল"). Color options: round swatches (the hex colour, the value name as accessible name and tooltip, a visible selected ring, a diagonal line + "sold out" text for unavailable values). Text options: the current buttons. All stay real radio inputs (keyboard and screen readers as today).
- **Nothing pre-selected** when the product has more than one variant (Magento): price shows "From ৳X" (lowest active variant final price; "From" only when variants differ in price), stock line hidden, SKU shows the parent SKU. A product with exactly one buyable combination pre-selects it.
- Add to cart without a full choice: the button stays enabled; clicking it shows "Please select Size." (per missing option, linked with `aria-describedby`, focus moves to the first missing option) — no cart call.
- When a full combination is selected: price (with discount / compare-at as today), stock message ("In stock", "Only 3 left", "Out of stock" + stock alert as phase 9), SKU, and the Add to cart button follow the variant; the URL query gets `?color=blue&size=m` style parameters (value slugs per option name) with `history.replaceState`, and opening such a URL pre-selects that combination (invalid parameters ignored).
- Quick view (if it shows options) behaves the same. The cart, mini cart, checkout, order, emails and PDFs already show the variant label (phase 5) — check Bangla labels there.

## 4. Listing pages

- Product cards of configurable products: price "From ৳X" when variant prices differ; up to 5 colour swatch dots of the color option (more → "+3"), decorative only on the card (the card link names the product; dots `aria-hidden`, plus visually hidden text "5 colours"); hovering a dot may switch the card image to that value's first image (pointer only, no layout shift). "Add to cart" on a configurable product's card goes to the product page ("Choose options" / "অপশন বেছে নিন") instead of adding.
- Public list items gain `price_range: { min, max }` (final prices of active variants, null for simple products) and `swatches: [{ value_id, value, swatch, image_url|null }]` (color option only, active values only, max 12).

## 5. Admin (Catalog → Products → product form, Options and variants)

- Option type select (Text buttons / Color swatches) per option; for Color, a colour picker + hex field per value (validated `#RRGGBB`). Bangla name fields stay as in phase 13.
- Variant table unchanged plus the variant label in Bangla where set; bulk "Set price / stock for all" helpers are optional.
- Images section: "Shown for" select per image (§2).
- Client checks mirror the API; viewer role read-only.

## 6. Demo catalog

A data migration (idempotent, only products still with the demo SKU/name and **no options yet**) turns some demo products into configurable ones, with Bangla option/value names and per-color images where DummyJSON has several images of one product (otherwise no per-colour images):

- 2 men's shirts and 1 pair of men's shoes: Color (3 swatches) × Size (S/M/L/XL or 40–44).
- 2 smartphones: Storage (128 GB / 256 GB / 512 GB, higher price per step) × Color (2–3 swatches).
- 1 laptop: RAM (8 GB / 16 GB) × Storage (256 GB / 512 GB) with prices per combination.
- Some combinations out of stock (to show the crossed swatch), the rest stocked from the product's current stock split across variants.
Names of the products used are listed in the implementation notes. `buynest:import-catalog` (fresh installs) applies the same data after importing.

## 7. Tests

- Backend: option type/swatch validation (hex, type), images `option_value_id` (belongs to product, reset when its value is deleted), public detail/list fields (`type`, `swatch`, `option_value_id`, `price_range`, `swatches`), demo migration (idempotent, staff products untouched), permissions; everything in phase 5 still passing.
- Storefront unit: swatches (names, selected ring, sold out), "Color: Blue" legend, nothing pre-selected + "From" price, Please-select messages and focus, URL parameters both ways, gallery switch, card swatches and "Choose options", Bangla.
- Admin unit: option type and colour fields, image "Shown for", validation, read-only viewer.
- Browser (`e2e/configurable.mjs`, by the lead): the admin makes a product configurable (Color swatches + Size, generate, prices/stock, an image for one colour); the store's card ("From", dots, "Choose options"); the product page (no pre-selection, Please select…, swatch choice changes price/stock/SKU/photo/URL, sold-out crossed, shareable URL), add two different variants → two cart lines with labels; checkout and the order with the variant labels and variant stock reduced; Bangla page; axe and 390px; cleanup.

## Implementation notes

(Each agent adds its notes here when done.)

### Implementation notes — storefront

**Files.** `frontend/src/services/adapters/laravelAdapter.js` (option and value `code` → `code`, lower-cased, null when missing; option `type` → `"color"|"text"`, value `swatch` only as `#RRGGBB` else null, image `option_value_id` → `product.imageOptionValueIds[]`, list `price_range` → `priceRange {min,max}|null`, `swatches` → `[{ valueId, value, swatch, imageUrl }]`, max 12); `frontend/src/utils/variants.js` (`initialSelection` pre-selects the single buyable combination, `variantPriceRange` now uses final prices, new `fromPrice`, `optionSlug`, `selectionFromSearch`, `searchForSelection`, `galleryOrder`); `components/product/VariantSelector.jsx/.css` (swatches, "Color: Blue" legend, per-option errors); `pages/ProductDetailsPage.jsx/.css`; `components/product/ProductCard.jsx/.css`; `components/product/QuickViewModal.jsx` ("From" price; options are still chosen on the product page via "Choose options"); locales `catalog` en/bn. Answers without the new fields keep working (text buttons, all images, no dots, normal price).

**Behaviour.**
- Nothing pre-selected when more than one variant is buyable. Exactly one variant, or exactly one in stock → that combination is pre-selected. Options with a single value are still pre-selected (nothing to choose).
- Before a full choice: price `From $20.00` / `শুরু ৳২০.০০` (lowest variant final price; only when variants differ, otherwise the shared price with its discount), no stock line, SKU row = parent SKU, Add to cart **enabled**. Clicking it shows one message per missing option under that option (linked to the option's group with `aria-describedby`), moves focus to the first enabled radio of the first missing option, no cart call. Choosing a value clears that option's message.
- Full choice: price, stock line, SKU, quantity limit, Add to cart and the phase 9 stock alert follow the variant. The URL query gets `<option code>=<value code>` for every option (e.g. `?color=blue&size=m`) via `history.replaceState`; other parameters are kept, and the option parameters are removed again when the choice becomes incomplete. **The keys are the API's language-independent `code` on each option and value** (the slug of the English name), so English and Bangla pages write the same link and a link opened in either language picks the same choice. For older answers without `code`, the slug of the shown name is used (lower case, anything other than letters/digits → `-`, accents stripped). Reading also accepts old name-slug links and ignores parameters that match nothing. Unknown options or values and impossible combinations are ignored per option. Sold-out combinations are accepted when stock alerts are on (BuyNest's API).
- Gallery: once a chosen value (any option) has its own images, the gallery shows those first, then the shared (null) images, leaves out other values' images, and starts at the first of them. Otherwise unchanged.
- Cards: `From $20.00` when `price_range.min != max`; up to 5 dots (`aria-hidden`, `title` = value), `+N` for the rest (`aria-hidden`), visually hidden "N colours"; pointer (`pointerType === 'mouse'`) hover on a dot with `image_url` swaps the card image (same 300×300 box, no layout shift), leaving restores it. Configurable cards keep "Choose options" (link to the product page) instead of Add to cart.

**Accessible names and texts for `e2e/configurable.mjs`** (English / Bangla):

| Thing | English | Bangla |
| --- | --- | --- |
| Option group (nothing chosen) | `group` "Color", "Size" (the option's name) | "রং", "সাইজ" (the API's Bangla name) |
| Option group (chosen) | `group` "Color: Blue" | "রং: নীল" |
| Swatch / size button | `radio` "Blue", "M" | "নীল" |
| Sold out value | `radio` "Green (sold out)" (enabled; label class `variant-selector__swatch--unavailable`, crossed) | "সবুজ (বিক্রি শেষ)" |
| Unavailable value (no such variant) | `radio` "Blue (unavailable)" (disabled) | "… (পাওয়া যাচ্ছে না)" |
| Please-select message | "Please select Size." (group's accessible description) | "সাইজ বেছে নিন।" |
| From price | text "From $20.00" (`.product-details__price-current`) | "শুরু ৳২০.০০" |
| Add to cart | `button` "Add to cart" | "কার্টে যোগ করুন" |
| Stock line | "In stock", "Low stock — only 2 left", "Out of stock" | "স্টকে আছে", "স্টক কম — মাত্র ২টি বাকি", "স্টক শেষ" |
| Stock alert | `button` "Email me when it's back" | "স্টকে ফিরলে আমাকে ইমেইল করুন" |
| Gallery thumbnails | `list` "Product images"; main image `.gallery__main img` | "পণ্যের ছবি" |
| Card colour count | visually hidden "5 colours" ("1 colour") | "৫টি রং" |
| Card action | `link` "Choose options for <name>" (visible "Choose options") | "<name>-এর অপশন বেছে নিন" ("অপশন বেছে নিন") |
| Card dots | `.product-card__swatch` (aria-hidden), `.product-card__swatch-more` "+3" | "+৩" |

**Tests.** `src/pages/Phase16.laravel.test.jsx` (10: swatches/names/sold out/no pre-selection/From/parent SKU, Please-select + focus + no cart call, full choice → price/stock/SKU/photo/URL/cart line, shared URL incl. sold-out + stock alert and invalid params, single combination pre-selected, pre-phase-16 answer, card From/dots/+N/count/Choose options, pointer-only hover image, same-price and simple cards, Bangla page + card with `expectNoEnglish`, the Bangla page writing `?color=blue&size=m` and an English link `?color=blue&size=s` pre-selecting নীল / S in Bangla); `src/utils/variants.test.js` (+6, incl. codes: a Bangla product writes `?size=m&color=blue`, an English link is read on a Bangla product, an old name-slug link still works); `src/services/adapters/laravelAdapter.test.js` (+1); phase 5 test in `CatalogPages.laravel.test.jsx` updated (Add to cart now enabled before a choice; group names match `/^Size/`). `details.chooseToAdd` and `details.and` were removed (the "Choose size and color…" hint is replaced by the Please-select messages).

### Implementation notes — backend (2026-11-24)

Paths are under `/api/admin/v1` (admin) or `/api/v1` (store). Products without options behave exactly as before (their new list fields are `price_range: null`, `swatches: []`).

**Schema** (migration `2026_11_24_000400_add_option_types_and_swatches`): `product_options.type` varchar(16) default `text`; `product_option_values.swatch` varchar(7) null; `product_images.option_value_id` nullable FK → `product_option_values`, `nullOnDelete` (removing a value, or its whole option, through PUT `/options` sets its images back to null = every choice).

**Admin `PUT /products/{id}/options`**
- Body: `{ options: [{ name, type?, name_bn?, values: [ "M" | { value, swatch?, value_bn? } ], values_bn? }] }`. Strings and objects can be mixed. Options are still matched by name and values by value (ignoring case), so ids stay.
- `type`: `text` | `color`. Left out: a kept option keeps its type, a new one is `text`. **At most one color option per product.**
- `swatch` (color options only): `#RRGGBB`, stored upper-case. **Required for every value of a color option through the API**: either sent, or — for a plain string or an object without a `swatch` key — the swatch the kept value already has. Text options store `swatch: null` (a swatch sent with a text value is ignored, not validated). Switching an option to `text` clears its swatches.
- `value_bn` inside a value object sets that value's Bangla (overrides `values_bn[M]`); phase 13 `name_bn` / `values_bn` work as before.
- 422 paths and messages (phase 5 paths unchanged: value text errors stay on `options.N.values.M`):
  - `options.N.type`: `Choose "text" (buttons) or "color" (colour swatches).` / `Only one option can use colour swatches.` (on the second color option)
  - `options.N.values.M.swatch`: `Enter the colour as #RRGGBB (for example #1E40AF).` / `Choose a colour for {value}.` (missing or null on a color option)
  - `options.N.values.M.value_bn`: `The Bangla value can be at most 40 characters.`
  - `options.N.values.M` (object without `value`): `The options.N.values.M field is required.`
- Audit `product.options_updated` also records type and swatch changes (`"Color (color): Red #FF0000, Blue #0000FF"`).

**Admin `PATCH /products/{id}/images/{imageId}`** — `{ alt?, option_value_id? }`, at least one of them.
- `option_value_id`: integer id of a value of **any option of this product** (the admin UI offers the color option's values, or the first option's), or `null` = shown for every choice. Another product's value, an unknown id, or a non-integer → 422 `option_value_id`: `Choose a value of this product's options.` Neither field sent → 422 `alt`: `Send the alt text or the choice the image is shown for.` Sending only one field leaves the other as it is.
- Answer as before: `{ data: [image items] }`; every image item (also POST/DELETE/reorder, and admin product detail `images`) is now `{ id, url, alt, position, is_upload, variants, option_value_id }`.
- Audit `product.image_updated` ("Image alt text / choice / alt text and choice changed on product SKU."), `before`/`after` = `{ alt, option_value_id, url }`.

**Admin product detail** (GET/POST/PATCH `/products/{id}`, PUT `/options`, variant endpoints): `options: [{ id, name, name_bn, code, type, position, values: [{ id, value, value_bn, code, swatch, position }] }]`. The admin product list items also carry `price_range` and `swatches` (inherited from the store resource).

**Public `GET /api/v1/products/{id}`**
- `options: [{ id, name, code, type, values: [{ id, value, code, swatch }] }]` (name/value in the request language as in phase 13; `swatch` `#RRGGBB` or null — a color value saved before phase 16 may be null: show a neutral swatch with the name).
- `images: [{ url, alt, variants, option_value_id }]` (null = every choice; ordered by position, so "that choice's images first" = filter by `option_value_id`).
- The detail also has `price_range` and `swatches` (same as the list).

**Option and value `code`** (added at the lead's request, for `?color=blue&size=m` URLs): computed, not stored — `Str::slug` of the **English (base)** option name / value, the same in every language (option "Color" → `color`, values "Blue" → `blue`, "128 GB" → `128-gb`, "40" → `40`, "Sierra Blue" → `sierra-blue`). If the slug would be empty it is `option-{id}` / `value-{id}`. Codes follow the English text: renaming an option or value in the admin changes its code (old links then simply don't pre-select). Names are unique per product ignoring case, but two names differing only in punctuation could share a slug; the storefront should take the first match.

**Public list items** (`GET /api/v1/products`, home `featured_products`, related/upsells/cross-sells, wishlist cards, compare):
- `price_range: { min: "0.00", max: "0.00" } | null` — the active variants' final prices (product discount and catalog price rules for everyone, the same numbers as the detail's `variants[].final_price`; sold-out active variants count). `null` for simple products and for a configurable product with no active variant. "From" only when `min !== max`.
- `swatches: [{ value_id, value, swatch, image_url }]` — the product's **color** option (the one with `type: "color"`), only values used by at least one active variant (sold-out ones included), option order, max 12. `value` in the request language; `swatch` may be null (legacy); `image_url` = that value's first image by position (null when it has none). `[]` when there is no color option.
- Queries: lists eager-load `Product::CARD_RELATIONS` (`options.values`, `variants`, `optionImages` = images with an `option_value_id`); a listing makes the same number of queries for 2 or 8 configurable products (tested). Anything else rendering a card falls back to `loadMissing` for configurable products only.

**Demo catalog** — `Database\Seeders\ConfigurableDemoSeeder`, run by migration `2026_11_24_000500_add_configurable_demo_products` (applied to the dev DB) and by `buynest:import-catalog` after each import. A product is changed only when it still has the demo SKU **and** demo name, is not deleted, and has **no options and no variants**; so it runs once per product and never touches staff work. Nothing is downloaded. All combinations are active; stock is the product's stock split across the stocked ones (at least 1 each, the product's total stays the same); `sold_out` combinations have 0. Per-colour images only when the product has more images than colours (image 0 shared, images 1..n → colour 1..n). Variant SKUs are `{SKU}-{VALUE}-{VALUE}` upper-case (as phase 5's generate). Prices: the product price for the base combination (variant price null), higher steps rounded to `.99`. `import-catalog` now keeps an imported image's `option_value_id` (matched by URL) when it re-creates images, and resyncs a configurable product's stock.

| id | Product (store URL) | Options (Bangla) | Sold out | Per-colour images |
|---|---|---|---|---|
| 83 | Blue & Black Check Shirt (`/products/83`) | Color রং (color): Blue নীল #1E3A8A, Black কালো #111827, Grey ধূসর #6B7280 × Size সাইজ: S, M, L, XL | Black/S, Grey/XL | yes (4 images) |
| 85 | Man Plaid Shirt (`/products/85`) | Color রং (color): Red লাল #B91C1C, Blue নীল #1D4ED8, Green সবুজ #15803D × Size: S, M, L, XL | Green in every size (crossed swatch before any choice), Red/XL | yes |
| 90 | Puma Future Rider Trainers (`/products/90`) | Color রং (color): White সাদা #F9FAFB, Black কালো #111827, Blue নীল #2563EB × Size সাইজ: 40–44 (৪০–৪৪) | Blue/40, Blue/41, Black/44 | yes |
| 123 | iPhone 13 Pro (`/products/123`) | Storage স্টোরেজ: 128 GB (base), 256 GB (+15 %: 1264.99), 512 GB (+35 %: 1484.99) × Color রং (color): Graphite গ্রাফাইট #41424C, Sierra Blue সিয়েরা ব্লু #9BB5CE | 512 GB/Sierra Blue | yes (3 images, 2 colours) |
| 133 | Samsung Galaxy S10 (`/products/133`) | Storage স্টোরেজ: 128 GB, 256 GB (804.99), 512 GB (944.99) × Color রং (color): Prism Black প্রিজম কালো #1F2937, Prism White প্রিজম সাদা #F3F4F6, Prism Blue প্রিজম নীল #3B82F6 | 512 GB/Prism White, 128 GB/Prism Blue | no (3 images, 3 colours) |
| 82 | New DELL XPS 13 9300 Laptop (`/products/82`) | RAM র‍্যাম: 8 GB, 16 GB (+20 %) × Storage স্টোরেজ: 256 GB, 512 GB (+12 %) → 1499.99 / 1679.99 / 1799.99 / 1979.99 | 8 GB/512 GB | no colour option |

Prices above are before the product's discount (the store shows final prices, e.g. iPhone 13 Pro `price_range` 996.92–1345.85 with its 9.37 % discount).

**Tests**: `tests/Feature/ConfigurableProductTest.php` (7 tests: admin types/swatches and kept ids, validation paths, images per choice incl. reset on value removal and the public detail, list `price_range`/`swatches` incl. Bangla and inactive variants, no N+1 on listings, the demo seeder (idempotent, staff products untouched, stock split, per-colour images), viewer read-only). Existing tests asserting the exact image/option keys were updated for the new keys.

### Implementation notes — admin (2026-11-24)

**Files.** Admin app: `admin/src/components/ProductVariants.jsx` (type select per option, colour fields per value of a color option, client checks, server 422 paths on their fields, variant label in Bangla), `admin/src/components/ProductImages.jsx` ("Shown for" per image), `admin/src/pages/ProductFormPage.jsx` (passes the options to Images; the phase 13 Bangla save of option names now resends each option's `type` and, for color, `{ value, swatch }` so it never resets them), `admin/src/api/admin.js` (`updateProductImageChoice`), `admin/src/admin.css`, tests `admin/src/pages/Phase16.test.jsx`. BFF: `frontend/server/adminCatalogApi.js` (`validateOptions` + `optionLook`, `validateImage`), `frontend/server/shop/adminCatalog.js` (`adminOption` type/swatch, `adminImage` optionValueId, `toOptionLookBody`, `updateImage`), tests `frontend/server/api.adminPhase16.test.js`.

**BFF (camelCase ↔ snake_case).**
- `PUT /api/admin/products/:id/options`: each option `{ name, type?, values: [text | { value, swatch }], nameBn?, valuesBn? }`. `type` must be `text` | `color` (422 `options.N.type`); color values need `#RRGGBB` (422 `options.N.values.M.swatch`, sent upper-case); a swatch on a text value is dropped (null); a second color option → 422 `options.N.type` "Only one option can use colour swatches.". With a type the API gets `{ name, type, values: [{ value, swatch }], name_bn?, values_bn? }`; with no type and plain strings it gets exactly the phase 5/13 body.
- Read (product detail and every options/variants answer): option `type` (`color` | `text`, anything else → `text`) and value `swatch` (`#RRGGBB` upper-case or null) — only when the API sends them, so pre-phase-16 answers map as before.
- `PATCH /api/admin/products/:id/images/:imageId`: `{ alt?, optionValueId? }` (at least one; `optionValueId` positive integer or null) → API `{ alt?, option_value_id? }`; only the fields sent are forwarded. API 422 `option_value_id` comes back as `optionValueId`. Image items gain `optionValueId` (integer or null) when the API sends `option_value_id`.

**Admin form behaviour.** Option type select per option; choosing "Color swatches" shows a "Colours of option N" group with, per value typed in the values field, a native colour picker and a hex text field (picker changes fill the hex field; the picker shows black until a colour is set). Save is refused client-side (no request) when a color value has no valid `#RRGGBB` or when two options are color. Text options are sent as plain strings plus `type: "text"` whenever the API has sent types (so turning a color option back to text is explicit). "Generate combinations" still requires saved options (disabled while the form is dirty). Images: "Shown for" lists the color option's saved values (else the first option's) with "All colours" ("All choices" when that option is not color) = null; a change is saved right away ("Image 1 is shown for Red."). No select when the product has no saved options. Viewer (`products.view` only): the option fieldset (type selects, colour pickers, hex fields) is disabled, no Save/Generate/Add buttons, images show the text "Shown for: Blue" / "Shown for: All colours".

**Accessible names for `e2e/configurable.mjs`** (all inside `region` "Options and variants" unless noted; N = 1-based option position, `<Option>` = the option name as typed, or "Option N" while empty):

| Thing | Role / accessible name |
| --- | --- |
| Option name / values | `textbox` "Option N name", "Option N values" (values comma-separated: "Red, Blue") |
| Option type | `combobox` "Option N type", options "Text buttons" (`text`) / "Color swatches" (`color`) |
| Colour group | `group` "Colours of option N" |
| Colour picker per value | `<input type=color>` labelled "`<Option>` value `<Value>`: swatch colour", e.g. "Color value Red: swatch colour" (set with `fill('#c0392b')`) |
| Hex field per value | `textbox` "Color value Red: hex code" (easiest to fill: "#C0392B") |
| Colour error | "Pick a colour for Red as #RRGGBB (for example #1E40AF)." (hex field's description) |
| Add / remove option | `button` "Add option"; "Remove option Color" |
| Save options | `button` "Save options" → status "Options saved. …" |
| Generate | `button` "Generate combinations" → status "N new variants added, inactive with 0 in stock: …" |
| Variant table | `table` caption "Variants"; row header = label "Color: Red / Size: M" (plus Bangla label below, `lang="bn"`, when names are set) |
| Variant fields | `textbox` "SKU for Color: Red / Size: M", `spinbutton` "Price for Color: Red / Size: M", `spinbutton` "Units in stock for Color: Red / Size: M", `checkbox` "Sell Color: Red / Size: M", `button` "Save Color: Red / Size: M" → cell status "Saved" |
| Image choice (`region` "Images") | `combobox` "Shown for image N", options "All colours" + each value ("Red", "Blue"); status "Image N is shown for Red." |
| Image upload (`region` "Images") | file input "Add images", then `button` "Upload 1 image" / "Upload N images" → status "1 image uploaded." |

**Tests.** `admin/src/pages/Phase16.test.jsx` (9): type select and colour fields shown; switch to color → hex validation (no request), one-color-option rule, picker fills hex, saved body with types/swatches; server 422 `options.0.values.1.swatch` / `options.1.type` on their fields and text option sent with `type`; Bangla variant label; Bangla-only save keeps type/swatches; "Shown for" options and PATCH bodies (value and null); first-option fallback ("All choices"); no select without options; viewer read-only. `frontend/server/api.adminPhase16.test.js` (10): option checks (plain strings unchanged, objects/strings, error paths, one color option), image checks, read mapping (only when sent), write body, PUT/PATCH routes incl. API 422 path mapping. Existing phase 5 / 13 tests unchanged and passing.

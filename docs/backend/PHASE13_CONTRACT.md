# Phase 13 contract: the store in Bangla (বাংলা) and English

**Status: built (2026-11-23).** Choices made where this page left something open are in the implementation notes (backend, admin, storefront) at the end; how to add or change a translation is in [docs/I18N.md](../I18N.md).

Decided by the user (2026-11-19): shoppers can use the store in **Bangla or English**. Free: no outside service. Keeps the conventions of phases 1 to 12 (`snake_case`, money as 2-decimal strings, `{ data }`, Laravel 422 errors, `can.admin:<key>`, audit entries, the sign-in service (BFF) in front of every browser call, the API locked to the store in production, the DummyJSON demo mode working). **English stays the default everywhere**, so every existing test and browser suite keeps passing unchanged; Bangla is opt-in per shopper (and per store via a setting).

Locales: `en` (English, default) and `bn` (Bangla, Bangladesh: `bn-BD` for `Intl`). Text direction is left-to-right for both.

## 1. Choosing the language

- **Storefront:** a language switch in the header ("বাংলা" / "English", each written in its own language, `lang` attribute on each option) and in the footer. The choice is saved in a first-party cookie `buynest_lang` (1 year, `SameSite=Lax`, readable by the server functions) and in the signed-in customer's account (`customers.locale`), so it follows them across devices; the account value wins after sign-in. First visit with no cookie: the store setting `store.default_locale` (default `en`); the browser's `Accept-Language` is **not** used to switch automatically (predictable for tests and shoppers), but when it prefers Bangla and the store default is English, a small dismissible hint offers "বাংলায় দেখুন" once.
- `<html lang>` is set to `en` or `bn` and updated on switch; the page `<title>` and meta description follow the language.
- URLs don't change (no `/bn/` prefix this phase; SEO hreflang is a documented limit).
- **Setting** `store.default_locale` (`en`|`bn`) and `store.bangla_digits` (bool, default `true`: when the language is Bangla, numbers, prices and dates use Bangla digits ০–৯) in Settings → General (`settings.edit`). `GET /api/v1/store` adds `locales: ["en","bn"]`, `default_locale`, `bangla_digits`.

## 2. Storefront text (React)

- Use **i18next + react-i18next** (exact versions pinned, at least two weeks old; recorded in the notes). Translation files per area under `frontend/src/locales/{en,bn}/<namespace>.json` (e.g. `common`, `catalog`, `cart`, `checkout`, `account`, `orders`, `auth`, `content`, `errors`, `marketing`), loaded with the app bundle for English and lazily for Bangla (a separate chunk). Keys are stable ids (`checkout.placeOrder`), not English sentences. Plurals with i18next's `Intl.PluralRules` support; interpolation for names, numbers, counts.
- **Every** shopper-facing string moves to the catalogs: header, navigation, footer, home, listing (filters, sort, empty states, pagination), product page (stock, variants, reviews, Q&A-like texts, specifications labels from the app, compare, wishlist), cart and drawer, checkout (all steps, field labels, hints, validation messages from the Zod schemas, payment method texts incl. SSLCommerz/Stripe/PayPal/COD notes), confirmation, account pages (profile, addresses, orders, returns, rewards, stock alerts, data export/delete, email change), sign-in/sign-up/verify/forgot, gift cards, newsletter, cookie consent banner, CMS page chrome, 404, error boundary, toasts, `aria-label`s and live-region announcements, `<title>`s. The `ComponentLabPage` and `learning/` demos may stay English.
- **Numbers, money and dates** through `Intl` with the active locale: `bn-BD` gives Bangla digits; when `bangla_digits` is off use `bn-BD-u-nu-latn`. The phase 12 money formatter and phase 11 display currencies use the active locale (৳১,২৫০.০০ in Bangla with Bangla digits).
- **Server messages:** the API answers validation and error messages in the request's language (§3), so field errors appear in Bangla too. The sign-in service forwards the language (`Accept-Language: bn` from the cookie) on every API call, and its own messages (session expired, too many attempts, etc.) are translated too (a small server-side catalog).
- **Product and category content** comes from the API already in the active language (§3), falling back to English per field.
- Translation quality: natural, polite Bangla for shoppers (আপনি form), common e-commerce words as Bangladeshi shoppers use them (e.g. "কার্ট", "চেকআউট", "অর্ডার" are fine where they are the everyday words). A glossary of the chosen terms goes in `docs/I18N.md` with how to add or change a translation.
- **Tests:** a unit test that every key in `en` exists in `bn` and vice versa (no missing or extra keys, same interpolation variables); a test that no shopper-facing component renders a hard-coded English sentence in Bangla mode (render key pages in `bn` and assert no `[a-zA-Z]{4,}` words remain except allowed brand/product names and codes, or an equivalent practical check); Bangla rendering tests for header, listing, product, cart, checkout (including validation errors), confirmation, account.
- Demo mode: the language switch works for app text; DummyJSON product content stays English.

## 3. Backend

- **Locale per request:** middleware reads `Accept-Language` (only `en`/`bn`; anything else → the store default) and sets `App::setLocale`. Signed-in customers' API requests use the request header (the store sends the current choice); `customers.locale` (`en`|`bn`, nullable = store default) is stored via `PATCH /api/v1/me { locale }` and returned in `/me`.
- **Validation and error messages:** `lang/bn/validation.php`, `lang/bn/auth.php`, `lang/bn/passwords.php`, `lang/bn/pagination.php`, plus the app's own messages (`lang/{en,bn}/buynest.php` or JSON) for every custom 422/403/404 message shoppers can see (cart, checkout, coupons, gift cards, reward points, stock, payments, returns, account). Attribute names translated. Admin-only messages can stay English.
- **Product and category translations:** `product_translations` (`product_id, locale, name, short_description, description, meta_title, meta_description`, unique product+locale) and `category_translations` (`category_id, locale, name, description, meta_title, meta_description`); CMS `pages` and home content blocks get the same (`page_translations`: `title, content, meta_title, meta_description`). The storefront API answers the requested locale with **per-field fallback** to the base (English) text, and adds `locale` (the language actually used for the name) so the store can mark untranslated items if useful. Search (phase 10 FULLTEXT) also searches Bangla names/descriptions (FULLTEXT index on the translation table; Bangla words are space-separated so the default parser works; the typo vocabulary is built per locale or Bangla is excluded from typo correction — document the choice). Slugs stay the same in both languages.
- Product option names/values (e.g. "Size", "Blue") and specifications (phase 11) get Bangla versions too (`translations` json on options/values and on each specification row `{ label_bn, value_bn }`, or a translation table — implementer's choice, documented), with fallback.
- **Emails:** each email template (phase 7) gets a Bangla version: `email_templates` adds `locale` (unique key+locale), defaults in `EmailTemplateCatalog` for both languages (natural Bangla). Mails are sent in the customer's language (`customers.locale`, or the language the order was placed in for guests: `orders.locale`, new), with the money and dates in that locale.
- **PDFs** (invoices, credit memos) in the order's language with Bangla labels (Noto Sans Bengali from phase 12 is already bundled; make Bangla text the primary font for `bn` documents so conjuncts render as well as dompdf allows; document dompdf's known limits with complex Bangla shaping and check the output is readable).
- `orders.locale` (char 2) recorded at placement from the request locale.

## 4. Admin

- The admin stays in **English** (staff tool). New:
  - Product form: a **Bangla** tab/section with name, short description, description, SEO title and description; option and value names; specification rows in Bangla. Shows which fields fall back to English.
  - Categories and CMS pages/home blocks: the same Bangla fields.
  - Email templates: a language switch (English / Bangla) per template, editing and previewing each; "Reset to default" per language.
  - Settings → General: default store language and "Use Bangla digits".
  - Customers: the customer's language shown (and editable) on the customer page; orders show the order's language.
  - Products grid: an optional column/filter "Bangla: complete / missing" so staff can find untranslated products. CSV import/export columns `name_bn`, `short_description_bn`, `description_bn`, `meta_title_bn`, `meta_description_bn`.
- Proxy routes and mappings in `frontend/server` like earlier phases.

## Permissions

No new keys: product/category/page translations use `products.edit` / `categories.edit` / `content.edit` (whatever the base edit uses), email templates their existing key, settings `settings.edit`.

## Tests

Backend: locale middleware (en, bn, unknown → default), Bangla validation messages and custom messages, `/me` locale, product/category/page translations with per-field fallback, Bangla search, options/specifications translations, emails in the customer's/order's language with Bangla digits, PDFs in Bangla (text present, font embedded), `orders.locale`, CSV columns, settings and `/store` fields; English unchanged. Storefront: catalog parity, Bangla rendering of key pages, switch + cookie + account sync, Intl formatting with and without Bangla digits, server messages shown in Bangla. Admin: Bangla fields on product/category/page forms, email template language switch, settings, grid filter. Browser suite `e2e/bangla.mjs` (after `taka` in `run-all.mjs`): switch to Bangla, browse/search in Bangla, translated product content and fallback, checkout with a Bangla validation error, order confirmation and email in Bangla, invoice PDF, account language kept after sign-out/sign-in on another browser, admin editing Bangla product text that appears in the store, axe checks with `lang="bn"`; restores everything.

## Implementation notes — backend

Written by the backend agent; source of truth for exact shapes. **Status: backend done** — dev DB migrated (3 migrations below), full suite green: **535 tests** (499 existing, 10 of them with the new fields added to exact-shape expectations, + 36 new: `BanglaCatalogTest` 10, `BanglaMessagesTest` 15, `BanglaEmailsTest` 11); `pint --test` clean; `composer audit` clean. English stays the default: nothing changes for a request without `Accept-Language: bn`.

### Migrations
- `2026_11_20_000100_add_locale_to_customers_and_orders` — `customers.locale` varchar(5) null; `orders.locale` char(2) default `en`.
- `2026_11_20_000110_create_catalog_translations` — `product_translations` (+ FULLTEXT `name, description`), `category_translations`, `page_translations` (unique owner+locale, cascade delete); `product_options.translations`, `product_option_values.translations` json null.
- `2026_11_20_000120_add_locale_to_email_templates` — see Emails.

### Language of a request
- Middleware `SetLocale` (api group). Store routes: the highest-weighted entry of `Accept-Language` if it is `en`/`bn` (`bn`, `bn-BD`, `bn-BD,bn;q=0.9` → bn), anything else (or none) → `store.default_locale`. **Admin routes (`/api/admin/*`) are always English.** Every answer carries `Content-Language: en|bn`. The BFF should send `Accept-Language: bn|en` from the `buynest_lang` cookie on every call (also signed in; `customers.locale` is only used for emails).
- Validation messages, attribute names and every shopper-visible custom message (cart, checkout, coupons, gift cards, reward points, stock, payments, returns, account, auth, 401/403/404/429) come back in the request language. Keys of `errors` never change, only the texts.
- Where: Laravel's own texts in `lang/bn/{validation,auth,passwords,pagination}.php` (with an `attributes` map for every store field, incl. `shipping_address.*`, `items.*.quantity`); the app's texts in `lang/bn.json` keyed by the exact English text (`:placeholders`); email/PDF texts in `lang/mail/bn.json`. English output is byte-identical.
- Framework messages on store routes (`Unauthenticated.`, `Too Many Attempts.`, `This action is unauthorized.`, 404 "পাওয়া যায়নি।", generic 405/500/503, "The given data was invalid." summary) are translated in `bootstrap/app.php` (`withExceptions` → `respond`), which works out the language itself for errors raised before the middleware and sets `Content-Language`.
- Left English (staff/webhook only): refunds/credit memos, admin cancel/invoice rules, gift card balance adjust, Check payment, history/audit notes, Stripe/PayPal/SSLCommerz webhook and IPN answers, stored ledger texts ("Spent on order …").
- Numbers inside messages follow `bangla_digits`; money in coupon messages uses the store currency with Bangla digits in Bangla. Order numbers, emails and codes stay Latin.
- Labels on output only (DB keeps English): shipping method label/eta in `/store`, the cart's `shipping_options` and the order's `shipping_method`; payment method labels. The cart's `lines[].name` and `lines[].variant_label` are in the request language ("শার্ট", "সাইজ: মাঝারি"); **order items keep the English name/option snapshot** (staff read orders).
- Test note: Laravel's test client sends `Accept-Language: en-us,en;q=0.5` by default; send `Accept-Language: ''` to simulate "no header".

### `GET /api/v1/store` (new fields)
`locales: ["en","bn"]`, `default_locale: "en"|"bn"`, `bangla_digits: true|false`. In Bangla, `shipping_methods[].label`/`eta` are translated (ids unchanged). `return_reasons` stay as staff wrote them (they are sent back as the value).

### Customers
- `GET /api/v1/me` adds `locale: "en"|"bn"|null` (null = store default). `PATCH /api/v1/me { locale: "en"|"bn"|null }` saves it (422 `errors.locale` for anything else).
- Sign-up saves `locale` from an explicit `Accept-Language: en|bn` (null without one).
- Admin: `AdminCustomerResource.locale` (en|bn|null); `PATCH /api/admin/v1/customers/{id} { locale }` (`customers.edit`, audited).

### Orders
- `orders.locale` char(2), default `en` (older orders back-filled `en`). Store orders: the request language; staff-created orders: the customer's saved language, else the store default. `locale` is added to the customer `OrderResource` and `AdminOrderResource` (detail; grid rows too).
- Emails and PDFs of an order use: the customer's `customers.locale` → else `orders.locale` → else the store default.

### Catalog content (storefront answers)
Translation tables `product_translations` (`name, short_description, description, meta_title, meta_description`), `category_translations` (`name, description, meta_title, meta_description`), `page_translations` (`title, body, meta_title, meta_description`), unique (owner, locale). Every field falls back **per field** to the base (English) column when the Bangla one is empty. Slugs are the same in both languages.
- Products (list and detail, also related/upsells, home featured, compare, wishlist): `name`, `description`, `meta_title`, `meta_description` in the request language; `category.name` translated; new `locale` = language actually used for `name` (`"bn"` or `"en"`); new `short_description` (detail only: the Bangla short description in bn, else null — products have no English short description). `options[].name` and `options[].values[].value` translated; `specifications[]` `{label, value}` translated per field.
- Categories (`GET /api/v1/categories`): `name, description, meta_title, meta_description` translated + `locale`.
- Pages (`GET /api/v1/pages/{slug}`): `title, body, meta_title, meta_description` translated + `locale`.
- Home (`GET /api/v1/home`): hero and each banner may hold a `bn` object (see admin); in Bangla its non-empty fields replace the English ones; the `bn` objects are never sent to the store.
- Options/values: `product_options.translations` / `product_option_values.translations` json `{ "bn": { "name": "সাইজ" } }` / `{ "bn": { "value": "নীল" } }`. Specification rows (json) get `label_bn`, `value_bn`.

### Search
- `GET /api/v1/products?search=` also matches Bangla names/descriptions (LIKE + FULLTEXT `product_translations_search_fulltext` on `name, description`); in Bangla the relevance tiers use the Bangla name (fallback English). Search words keep Bangla vowel signs (`\p{M}`).
- **Typo correction is English-only**: words in Bengali script are never "corrected" (`corrected_query` stays null for them); the vocabulary is built from English text only.

### Admin API (staff stays English)
- Product `POST/PATCH /api/admin/v1/products[/{id}]` accept `translations: { bn: { name?, short_description?, description?, meta_title?, meta_description? } }` (each nullable string; a key left out is unchanged; `description`/`short_description` sanitized like the base description; all empty → the row is removed). `GET` (show) answers `translations: { bn: { name, short_description, description, meta_title, meta_description } }` (null = falls back to English) and `bangla: { complete: bool, missing: ["description", …] }`. Options (`PUT /api/admin/v1/products/{id}/options`): each option may send `name_bn` and `values_bn` (array, same order as `values`; null/"" = English); a key left out keeps the saved Bangla of options/values that keep their name. The admin product answers `options[].name_bn` and `options[].values[].value_bn` (null = English). Specifications rows: `{ label, value, label_bn, value_bn }`.
- "Complete in Bangla" = `name` translated, and `description` translated when the product has an English description. Products grid: `GET /api/admin/v1/products?bangla=complete|missing`; each row adds `bangla_complete: bool`.
- Categories `POST/PATCH /api/admin/v1/categories` and pages `POST/PATCH /api/admin/v1/pages`: the same `translations: { bn: {…fields above} }`; show/list rows answer `translations.bn` and `bangla: { complete, missing }`.
- Home `PUT /api/admin/v1/home`: `hero.bn = { eyebrow, title, description, primary_cta_label, secondary_cta_label, image_alt, highlights[] }`, `banners[].bn = { eyebrow, title, description, cta_label, image_alt }` (all optional/nullable).
- Settings → General: `general.default_locale` (`en`|`bn`), `general.bangla_digits` (bool, default true).
- CSV export/import: last columns `name_bn, short_description_bn, description_bn, meta_title_bn, meta_description_bn`. Import follows the importer's rule for every column: an empty cell (or a missing column) leaves that Bangla field as it is; longer than the field allows → row error on that column (120/500/5000/190/500 characters). Clearing Bangla text is done in the product form.
- Duplicating a product copies its Bangla texts. Audit entries `product.translated`, `category.translated`, `page.translated` ("… Bangla text updated (name, description).").
- Email templates per language: see "Emails" below.

### Emails
- Migration `2026_11_20_000120_add_locale_to_email_templates`: `email_templates.locale` char(2) default `en` (old rows English); unique (`key`, `locale`) replaces unique `key`.
- Every template (19) has a Bangla default (`App\Support\EmailTemplateCatalogBn`, same variables, allowed tags; saving a default unchanged keeps it). A Bangla template without a customization uses the Bangla default, never the English customization. Codes and order numbers stay in Latin letters/digits.
- Admin API (`email_templates.manage`, routes unchanged): every route takes `locale` = `en`|`bn` (default `en`; query on GET, query or body on PUT/POST; other values → 422 `errors.locale` "Choose English (en) or Bangla (bn).").
  - `GET /api/admin/v1/email-templates?locale=bn`: items add `locale` and `locales: { en: { is_customized, updated_at }, bn: { is_customized, updated_at } }`; `subject`, `is_customized`, `updated_at`, `updated_by` describe the requested language.
  - `GET /email-templates/{key}?locale=`: same plus `body`, `default_subject`, `default_body` of that language.
  - `PUT /email-templates/{key} { locale?, subject, body }`, `POST …/reset { locale? }`: that language only.
  - `POST …/preview`, `POST …/test { locale?, subject?, body? }`: rendered in that language with Bangla sample values and digits per the setting.
  - Audit texts unchanged for English; Bangla appends " (Bangla)".
- Language of each email: order emails (confirmation, status, payment not completed, cancelled by customer, invoice, shipment, refund, return status, gift card purchased) → customer's `customers.locale`, else `orders.locale`, else store default. Gift card received → the buying order's language. Abandoned cart, back in stock, staff "set password" code → customer's language, else store default (guest stock alerts: store default — guests' alerts don't store a language this phase). Sign-up verification, password reset, email change code, email changed, account deleted, newsletter confirmation → the language of the shopper's request. Newsletter campaigns stay as staff wrote them.
- Texts built in code (totals labels, next steps, status headings/messages, return texts, carrier/tracking labels, buttons, notes, stored shipping/payment labels) are translated; money, counts and dates follow the email's language (Bangla digits per `bangla_digits`); the layout's `<html lang>` follows it.

### PDFs (invoices, credit memos)
- Rendered in the order's language (same rule as order emails), also when staff download them; every label translated; money/quantities with Bangla digits per the setting; dates "১৯ নভেম্বর ২০২৬" (English keeps "M j, Y"); `<html lang>`; Bangla documents list Noto Sans Bengali first.
- dompdf limits (checked with pdftotext and a rendered page image): dompdf does no Bangla shaping. Pre-base vowel signs (ি ে ৈ, and the split ো ৌ) are reordered for drawing (`DocumentPdfs::visualBangla()`, applied only to the PDF render), so words read correctly; **conjuncts and reph still show a visible hasanta** (ন্ট, র্ড). Text copied out of a Bangla PDF comes out in drawn order. Both Noto Sans Bengali and DejaVu subsets are embedded.

### Bangla glossary (backend texts)
অর্ডার (order), কার্ট (cart), চেকআউট (checkout), কুপন (coupon), ইনভয়েস (invoice), ডেলিভারি (delivery/shipping), ডেলিভারি চার্জ (shipping cost), শিপমেন্ট (shipment), পণ্য (product), দাম (price), ছাড় (discount), সাবটোটাল, মোট (total), ট্যাক্স (tax), পেমেন্ট, রিফান্ড, রিটার্ন (return), ক্রেডিট মেমো, গিফট কার্ড, রিওয়ার্ড পয়েন্ট, উইশলিস্ট, অ্যাকাউন্ট, সাইন ইন / সাইন আপ / সাইন আউট, পাসওয়ার্ড, ইমেইল, কোড, ঠিকানা (address), ফোন নম্বর, স্টক, স্টক শেষ (out of stock), পরিমাণ (quantity), রিভিউ, ক্যাটাগরি, নিউজলেটার, ক্যাশ অন ডেলিভারি, গ্রাহক (customer), স্টোর, অপশন (option/variant), সাইজ, রং (color). Polite আপনি form; brand names (bKash, Nagad, SSLCommerz, PayPal, Stripe) in Latin script.

### Choices left open by the contract
- `Accept-Language`: only its highest-weighted entry counts (`fr, bn` → store default), so a browser's list never switches the store unexpectedly.
- Sign-up stores `customers.locale` only when the request named `en`/`bn` explicitly.
- Translation storage: tables for products/categories/pages, json `translations` on options/values, `label_bn`/`value_bn` keys on specification rows; home content keeps `bn` objects inside the stored hero/banners.
- Products have no English short description: `short_description` exists only in translations (store gets it in Bangla, else null).
- Bangla completeness = name (+ description when there is an English one).
- Typo correction excluded for Bangla (vocabulary stays English).
- Bangla money keeps the phase 12 layout (`৳১,২৫০.০০`), not Intl's `bn-BD` (`১,২৫০.০০৳`, lakh grouping).
- Guest back-in-stock alerts store no language (emails use the store default); a `stock_alerts.locale` column would fix it later.
- Static numbers inside fixed sentences (e.g. "২,০০০ অক্ষর") are written in Bangla digits in the catalog regardless of `bangla_digits`.

### Money and dates in Bangla (emails, PDFs)
Same format as phase 12 (symbol first, groups of three) with Bangla digits when `bangla_digits` is on: `৳১,২৫০.০০`; off: `৳1,250.00`. Dates `১৯ নভেম্বর ২০২৬`. (`Intl` `bn-BD` writes `১,২৫০.০০৳` with Indian grouping; the backend keeps the phase 12 layout — the store may use either.)

## Implementation notes — admin

Written by the admin agent. The admin stays English; every input that holds Bangla text has `lang="bn"`. Bangla fields appear only when the API answer carries the Bangla data (older answers: the screens are unchanged). An empty Bangla field shows a "Falls back to English" badge with the English text shoppers see instead, read as part of the field's description.

### Screens
- **Product form** (`ProductBangla.jsx`, `BanglaField.jsx`): a "Bangla (বাংলা)" section saved with the product: name, short description, description, meta title, meta description; a "n of m main texts translated" line with Complete / Missing texts; the saved options' and values' Bangla names; each specification row's Bangla label and value. Only changed parts are sent. Option names go to `PUT products/:id/options` right after the product save (the options' own route, with the saved English names/values plus `nameBn` and `valuesBn` in the values' order); new options must be saved first (the section says so).
- **Categories** (edit/add dialog), **CMS pages** (editor, plus a preview of the saved, server-sanitized Bangla body), **Home page** (hero incl. 3 highlights, and every banner): Bangla fields with the same fallback badges.
- **Email templates**: list gains English / Bangla status columns (the Bangla badge links to `?lang=bn`); the editor has an English / Bangla tab switch (WAI-ARIA tabs, `?lang=bn` in the address); subject, body, preview, test send and "Reset Bangla to default" act on the chosen language only.
- **Settings → General**: "Default store language" (English / Bangla) and "Use Bangla digits" (with an example).
- **Customer page**: a Language tile (Store default / English / Bangla) and a Language select in the Account tab (`locale`, null = store default).
- **Order page**: Customer panel shows "Language: Bangla (বাংলা) · placed in this language".
- **Products grid**: optional "Bangla" column (Columns chooser; Complete / Missing badge) and a "Bangla: Any / Complete / Missing" filter (saved filters include it).
- **Import / Export**: the five `*_bn` columns listed, with a UTF-8 note.

### Admin service (frontend/server) — app names ↔ API
- `adminPhase13Api.js` (rules, email-template routes), `shop/adminPhase13.js` (mappings); hooks in adminApi.js, shop/admin.js, adminCatalogApi.js/shop/adminCatalog.js, adminSystemApi.js/shop/adminSystem.js, adminSalesApi.js/shop/adminSales.js, shop/adminPhase11.js.
- Records carry `bn: { …same field names as English… }` ('' = not translated) ↔ API `translations.bn.{snake_case}` (sent as null when empty). Products also `banglaStatus: complete|missing` from `bangla.complete` / `bangla_complete`; `GET products?bangla=complete|missing` → API `bangla=`.
- Specification rows `{ label, value, labelBn, valueBn }` ↔ `label_bn/value_bn` (the Bangla keys are only sent when the browser sent them). Options read `nameBn` / `values[].valueBn` from `name_bn`/`value_bn`; `PUT products/:id/options` takes optional `nameBn` and `valuesBn` → `name_bn`, `values_bn` (left out = the saved Bangla stays).
- Home: `hero.bn { eyebrow, title, description, primaryCtaLabel, secondaryCtaLabel, imageAlt, highlights }`, `banners[].bn { eyebrow, title, description, ctaLabel, imageAlt }` ↔ API `hero.bn` / `banners[].bn` in snake_case.
- Email templates: every route takes `?locale=en|bn` and forwards it (query and body); without `locale` the phase 7 routes run unchanged; any other value → 422 `errors.locale`. The list adds `locales: { en|bn: { subject, isCustomized, updatedAt } }` (subject is '' when the API doesn't send one); detail/preview add `locale`.
- Customers `locale` (en|bn|null) both ways; orders `locale` (detail and grid rows); Settings `general.defaultLocale`/`general.banglaDigits` ↔ `default_locale`/`bangla_digits`.
- Bangla length limits checked before any call (the API's): product 120/500/5000/190/500, category 120/5000/190/500, page title 160, meta title 160, meta description 300, home like the English fields.

### Tests
- `admin/src/pages/Phase13.test.jsx` (14): helpers, product Bangla section (lang, fallback, only-changed saves, options route, 422 on fields, no section for older answers), category, page, home, email template switch/preview/save/reset per language, settings, customer and order language, grid column/filter, CSV columns. Admin suite: 194 tests.
- `frontend/server/api.adminPhase13.test.js` (14). Server suite: 337 tests.

### Known limits
- Home-block Bangla depends on the backend's `PUT /home` accepting `hero.bn` / `banners[].bn` as documented above; nothing in the admin breaks if a GET doesn't send them (the Bangla fields just don't show).

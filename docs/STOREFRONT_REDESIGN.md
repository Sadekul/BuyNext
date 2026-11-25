# Storefront redesign: indigo + coral, bold and colourful

**Status: built (2026-11-25).** Asked by the store owner: "update the storefront design: eye-catching and modern, and update the theme colour." Chosen: **Indigo + coral** theme, **bold and colourful** style.

Storefront only (`frontend/src`); the admin keeps its look. Everything that works today keeps working: English and Bangla (every new text in both locales, Bangla digits), phones (no sideways scroll at 390px), accessibility (WCAG 2.1 AA contrast, keyboard, visible focus, `prefers-reduced-motion`), the DummyJSON demo mode, existing accessible names that tests use (button and link names, headings, labels), and the unit and browser tests.

## Theme (done — `frontend/src/assets/styles/tokens.css`)

| Token | Value | Use |
|---|---|---|
| `--color-primary` | `#4338ca` indigo | buttons, links, focus (white text 7.9:1) |
| `--color-primary-hover` / `-strong` / `-soft` | `#3730a3` / `#312e81` / `#eef0ff` | hover, dark accents, tinted backgrounds |
| `--color-secondary` | `#1e1b4b` ink | headings, header text, footer background |
| `--color-accent` | `#ff6b57` bright coral | **shapes and large type only**; text on it must be ink `#1e1b4b` (5.7:1), never white (2.8:1) |
| `--color-accent-strong` | `#c2412d` | small coral text, sale badges with white text (5.1:1) |
| `--color-accent-soft` | `#fff1ee` | coral tints |
| `--gradient-brand` | indigo → violet → pink | hero/announcement/newsletter backgrounds (white text ≥ 4.6:1 across) |
| `--gradient-warm` | coral → amber | decorative highlights (ink text only) |
| `--color-bg-muted` / `--color-bg-tint` | `#f6f6fd` / `#f1efff` | section backgrounds |
| `--shadow-glow` | indigo glow | hover lift on primary elements |

Radii are a little rounder (cards 1.25rem), shadows tinted indigo. No colour may be hard-coded in components: use tokens (replace the remaining emerald/green values, `#047857` etc.).

## Shell and components (builder A)

- **Announcement bar** above the header: slim, `--gradient-brand`, one short message in the shopper's language (free delivery threshold from the store settings when set, otherwise returns/secure checkout), dismissible (remembered per browser), not shown in the checkout.
- **Header:** cleaner and taller-feeling: logo, a prominent rounded search with an indigo button, account / wishlist / cart icons with coral count badges (ink text), the language switch as a compact pill. Category navigation row with a small icon per category (lucide icons mapped by slug, a generic icon otherwise), active item underlined in coral; "Deals" in coral-strong.
- **Buttons:** primary indigo with a subtle glow on hover; secondary/outline in ink; pill shapes for main actions.
- **Product card:** larger image area on a soft tint, second photo on pointer hover (when the product has one; no layout shift; not on touch), badges: sale `-20%` (coral-strong, white text), "New" (indigo soft), "Low stock"; hover lift with `--shadow-lg`; a round quick "Add to cart" icon button on simple products (keeps the accessible name "Add <product> to cart" or the current one — check the tests); configurable products keep "Choose options".
- **Product page, cart, checkout, account, footer:** restyled with the new tokens (sticky add-to-cart summary on phones optional), footer on ink with indigo/coral accents, newsletter in the footer kept.
- Replace every hard-coded green/emerald value outside `components/home`.

## Home page (builder B)

Order (each section only when it has content; headings h2 with a short coloured kicker):
1. Hero banner / slider (existing): new tones (indigo, violet, coral-ink, ink) instead of navy/emerald/amber/rose look — keep the stored tone keys working (map old keys to new colours).
2. **Shop by category:** tiles with a product photo per category (from the category's image or its first product's thumbnail), name, hover zoom; horizontal scroll on phones.
3. **Today's deals:** discounted products in a coloured band. A countdown only when backed by a real end date (e.g. a catalog price rule's end date exposed by the API); **no fake countdowns**.
4. **Promo grid:** the existing home banners as a bento grid (one large, two small) with gradients.
5. **New arrivals:** a horizontal product carousel (scroll-snap, Previous/Next buttons, keyboard accessible), newest products if the API can sort by newest, otherwise featured.
6. **Benefits:** restyled as colourful icon tiles.
7. **Brands:** a strip of brand names (styled chips or logos if the API has them) linking to the brand filter.
8. **Newsletter** block on `--gradient-brand` (uses the existing newsletter API/form).

Only data the API already gives (no backend changes in this round); a section that needs missing data is left out and noted.

## Tests

Unit tests for new components (announcement bar dismiss, category tiles, carousel buttons/keyboard, deals band without fake countdown, quick add), locale key parity, lint, build. The lead runs every browser suite on the dev server and the production build afterwards and fixes what the new layout changes.

## Implementation notes

(Each builder adds notes here.)

### Implementation notes — shell and components (builder A)

**What changed**

- **Tokens** (`tokens.css`, added at the end of the existing groups, nothing renamed): `--color-danger`, `--color-warning-border`, on-ink colours (`--color-on-dark`, `--color-on-dark-muted` 8.5:1 on ink, `--color-on-dark-line`, `--color-on-dark-hover`), `--color-overlay` (modal backdrop), `--color-glass` (sticky header, quick-view pill), `--color-primary-glow` / `--color-accent-glow` (footer corners), `--color-swatch-edge`, `--ring-focus` / `--ring-error` (input focus rings), `--shadow-primary` (resting shadow of primary buttons).
- **Announcement bar** (`components/layout/AnnouncementBar.jsx`): now one message (the first of `storeAnnouncements()`: free delivery over the store's threshold when set, otherwise "30-day hassle-free returns") on `--gradient-brand`, with a close button ("Close announcement" / "ঘোষণা বন্ধ করুন"). The closed message is kept in `localStorage` `buynest.announcement.v1` (guarded: works with storage blocked); a different message shows again. `MainLayout` leaves it out on `/checkout*`. The earlier desktop row of all three messages is gone.
- **Header**: glass white bar with a soft shadow, taller on desktop (5rem), wider search (2px border, white on focus, indigo button with glow), icon buttons tinted indigo on hover, count badges coral with **ink** text, account link a pill on desktop, language switch a compact pill (indigo for the current language; the footer variant white-on-ink).
- **Category navigation** (`MainNavigation`, `MobileNavigation`): an icon per link from the new `components/layout/categoryIcons.js` (`categoryIcon(slug)`, `navLinkIcon(link)`, `<NavIcon>`; Home, Shop all, Deals, "More", every demo category slug; unknown slugs get a tag icon). Icons are `aria-hidden`, so link names are unchanged. Active/hover underline is coral (3px); "Deals" is coral-strong text with a coral icon; submenus have an indigo top edge. The desktop row may wrap to a second line rather than scroll (submenus are absolutely positioned and would be clipped by a scroll box). Builder B may reuse `categoryIcon(slug)` for category tiles.
- **Buttons** (`Button.css`): bolder text; primary has a resting indigo shadow and a glow + 1px lift on hover; outline turns indigo-soft on hover; new `btn--icon` modifier (round 2.75rem icon button). Lifts are switched off under `prefers-reduced-motion`.
- **Product card**: photo inset on a soft indigo radial tint, larger hover zoom, lift with `--shadow-lg`. **Second photo on hover**: the first gallery image that isn't the thumbnail, rendered only after the first *mouse* `pointerenter` (never on touch) as a decorative `background-image` span over the photo (fades in, same box, no layout shift, and no second `<img>` — the browser suites' `.product-card__media img` locators still match one image). The API's list items carry no `images`, so with the Laravel API the swap only happens where the product object has images (demo mode, recently viewed snapshots that include them); no backend change made. **Badges**: sale `-20%` (coral-strong, white text 5.1:1), new `isNew` prop → "New" / "নতুন" (indigo soft with indigo outline; defaults to `product.isNew === true`, so existing callers are unaffected), "Low stock", "Out of stock". **Quick add**: in the grid layout simple products get a round icon button beside the price (`.product-card__buy` row). Its accessible name is unchanged — visually hidden "Add to cart" / "Sold out" / "Unavailable" (also `title`). List layout keeps the full text button. Configurable products and gift cards keep "Choose options" / "Choose amount". The minimum-order note now sits above the price row (still before the button in reading order). Sale prices are coral-strong.
- **Product page**: brand as an indigo-soft pill, price in a tinted panel (sale price coral-strong, price-rule name as a coral pill), stock as a pill with a coloured dot, perks as icon tiles (indigo / coral-strong / deep indigo), section headings with a short coral bar, zebra-striped specification tables, gallery on an indigo tint with a ring on the active thumbnail. No sticky phone add-to-cart bar (optional in the plan; left out so nothing covers the page's own buttons in the browser suites).
- **Cart / checkout**: cart lines in a white card; order summary (also the checkout summary, same `.cart-summary` class) is a white card with a brand-gradient top edge and a tinted total row; free-delivery progress bar uses the brand gradient; checkout steps are white cards with a gradient bar on the left and a stronger shadow while focused. Cross-sell heading gets the coral bar. The phone grid rule `minmax(0, 1fr)` (CartPage.layout.test.js) is untouched.
- **Account**: header on a soft indigo tint with a coral kicker; active account link solid indigo with white text; desktop side menu in a sticky white card; profile card on an indigo tint with an indigo avatar ring (kept light because it also holds the edit-name form). Sign-in/up cards get a brand-gradient top edge.
- **Footer**: ink with a gradient top edge, soft indigo/coral corner glows, on-dark text tokens, coral bars under group headings, coral contact icons, coral social buttons with ink icons on hover, white focus rings. The newsletter form was not in the footer before and is still only on the home page (builder B restyles it); adding it to the footer as well would duplicate its `newsletter-title` id and heading on the home page.
- **Hard-coded colours** replaced outside `components/home`: the emerald `#6ee7b7` / `#cbd5e1` in footer, logo, toast and announcement bar; the green focus rings in inputs and the search bar; `#b91c1c` (danger buttons), `#b45309`, `#fde68a`, the modal backdrop, swatch edges, `LanguageSwitch` fallbacks (including the undefined `--color-surface`). `index.html` `theme-color` and `public/favicon.svg` are indigo `#4338ca`. Left as is: the print-only black/white in `InvoicePage.css` and the dev-only `/learn` lab.

**Accessible names and texts**

- No existing accessible name, heading or label changed. Product card buttons are still "Add to cart" / "Sold out" / "Unavailable" (now an icon button in the grid with hidden text), "Choose options for …", "Quick view: …", "Save … to wishlist".
- New: "Close announcement" button (bn "ঘোষণা বন্ধ করুন") and the "New" badge text (bn "নতুন"); both keys in en and bn.
- The announcement bar no longer shows the second and third messages on desktop, and is absent in the checkout.

**What the browser suites may notice**

- The announcement bar is now one line with a close button; a suite that reads all three messages, or expects the bar in the checkout, would need updating (none found by grep).
- `motion.mjs` clicks `.product-card` nth(4) `getByRole('button', { name: /add to cart/i })` — still matches (hidden text); the button is now a 44px circle beside the price instead of a full-width button.
- On hover, cards with a second photo show a decorative span over the photo; `.product-card__media img` still matches one element.
- Header is 0.5rem taller on desktop (sticky offsets in suites, if any, use the element, not a number).

**Tests**: `components/layout/AnnouncementBar.test.jsx` (one message, empty, dismiss remembered, a new message shows again, blocked storage), `components/layout/categoryIcons.test.js`, and five new cases in `ProductCard.test.jsx` (round quick add keeps "Add to cart" / list keeps the text button, configurable keeps "Choose options", "New" badge, second photo on mouse hover only without another `<img>`, no second photo with one image). Full run: 79 files, 882 tests passing; lint clean; build OK.

### Implementation notes — home page (builder B)

**Sections built** (`pages/HomePage.jsx`, in this order; each one is left out when it has no data)

1. **Hero banner / slider** (`HeroBanner`, `HeroSlider`, unchanged markup and behaviour). New tones in `components/home/tones.css`, shared by slides and promo banners as `tone--<key>`. The stored keys stay, so saved content keeps working: `navy` → ink (ink → indigo-strong, coral glow), `emerald` → indigo (indigo → violet), `amber` → coral (coral-strong → deep rose), `rose` → violet (violet → magenta). Every stop takes white text at ≥ 5:1. Slides get decorative coral rings, a warm disc behind the photo and an ink-on-coral eyebrow pill. The single banner is light (tint with coral/violet glows, brand-gradient blob, coral underline under the h1, highlight pills). The admin's tone labels still say Navy/Emerald/Amber/Rose (admin not changed; worth relabelling later).
2. **Shop by category** (`FeaturedCategories`, own tile markup; `CategoryCard` not touched): up to 8 top-level categories, the configured ones in `data/homeContent.js` first. Photo = the category's `image_url` (BuyNest API), else the configured image, else its first product's thumbnail (`utils/homeSections.js` `pickCategoryTiles`). Tinted photo wells, hover lift and zoom. A sideways-scrolling row with scroll-snap on phones (inside the section, not the page), a grid from 640px.
3. **Today's deals** (`DealsBand`): the 4 biggest real discounts (≥ 1%) on products that can be bought (`pickDeals`), on `--gradient-warm` with ink text (never white on coral), an ink kicker pill and a round "Up to N% off" sticker (largest whole discount, number formatting gives Bangla digits). **No countdown**: `GET /products` gives `price_rule` as `{ id, name }` only, with no end date, so none is shown. Add one when the API exposes a rule's end date.
4. **Promo grid** (`PromoGrid` + `PromoBanner`): the home banners as a bento grid, in the admin's order. The first is large (spans two rows with 3+ banners; with 2 banners it's a 1.35fr / 1fr split). Ink-on-coral eyebrow pills, decorative rings, hover lift. The demo got a third banner (`smart-phones`, tone `amber`, en + bn) so the demo shows the full bento.
5. **New arrivals carousel** (`ProductCarousel`): with BuyNest's API, `GET /products?sort=newest&per_page=12` (new `newestProductsQuery`; `laravelProvider` maps sort field `createdAt` → `newest`; `productService.CAN_SORT_BY_NEWEST`). The demo can't sort by date (DummyJSON has no real dates), so it shows only the carousel below. **Featured products** (the CMS's `featured_products`; the demo's hand-picked list) uses the same carousel, kept because it is admin-managed content and unit tests expect the "Featured products" region.
6. **Benefits** (`BenefitsSection`): four tinted tiles with solid icon discs (indigo, coral with an ink icon, violet, ink). The h2 "Why shop with BuyNest" is now visible, with the kicker "Our promise".
7. **Brands** (`BrandStrip`): the 12 brands with the most products, picked from the product list the page already loads (`pickBrands`). The API has no brands endpoint and no logos, so these are chips (coloured initial, name, count) linking to `/products?brand=<name>`, the catalog's existing brand filter URL.
8. **Newsletter** (`HomeNewsletter`): the existing `components/forms/Newsletter` (same API, `source: 'footer'`, labels, modal) wrapped and restyled on `--gradient-brand`: white text, coral icon disc, coral Subscribe button with ink text, error on a white pill. `section.newsletter`, "Email address" and "Subscribe" are unchanged.

Also kept: **Recently viewed** (phase 11, before the newsletter). Section headings get a coral-strong kicker with a warm bar (`components/home/home.css`, scoped to `.home-section`).

**Removed or skipped**

- "Best sellers" and "Special offers" sections are gone. Best sellers was a hand-picked ID list, not sales data, and the API has no sales ranking. Special offers is replaced by Today's deals.
- Deals countdown: skipped, since the API has no end date (see 3).
- Brand logos: the API has none.
- `components/home/ProductSection.jsx` deleted (no longer used).

**Accessible names (new controls)**

- Carousel buttons: "<section title>: previous" / "<section title>: next" (e.g. "New arrivals: next", bn "নতুন পণ্য: পরের পণ্য"), `aria-controls` the list. They are disabled at either end. On a card, Left/Right move to the previous/next card's link and Home/End to the first/last. With `prefers-reduced-motion` the buttons jump instead of gliding.
- Brand chips: links named "<brand>, N products" (bn "<brand>, Nটি পণ্য").
- Regions: "Shop by category", "Big savings, in stock now" (kicker "Today's deals"), "Promotions", "New arrivals", "Featured products", "Why shop with BuyNest", "Shop by brand", newsletter as before.
- Unchanged: carousel "Featured", "Pause slides" / "Play slides", "Previous slide", "Next slide", "Show slide N", "N of M", one h1, "All products" link, Promotions banner headings in order.

**Motion and phones**: every hover lift and zoom is off under `prefers-reduced-motion`. Screenshots at 1280px (en) and 390px (en, bn) showed no sideways page scroll, one h1, and 24 product cards.

**Tests**: `utils/homeSections.test.js` (tiles order and photo fallbacks, deals filtering and badge value, brands order and links) and `components/home/HomeSections.test.jsx` (carousel buttons, end states, reduced motion, keyboard; deals band without a countdown and with Bangla digits; category tiles; brand chips; promo grid order, large tile and tone classes). Full run: 81 files, 898 tests passing; lint clean; build OK.

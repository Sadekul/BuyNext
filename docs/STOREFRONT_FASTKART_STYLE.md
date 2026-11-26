# Storefront restyle: follow the reference design (flat, light, steel blue)

**Status: built (2026-11-25)** — see the SQA report (F1–F9). Asked by the store owner: "update design and theme colors, follow my reference link" — Pixelstrap's Fastkart demo 9 (themes.pixelstrap.com/fastkart/front-end/index-9.html, body class `theme-color-5`). Fastkart is a **commercial ThemeForest template**: match its *look* (palette, flat style, proportions, kinds of sections) with **our own code, CSS, icons, images and texts — never copy its files, markup, images, icons or wording.** Colour values and the free Google Font (Public Sans) are not copyrightable and are used.

Everything built in phases 1–17 keeps working: all features, English + Bangla (Bangla digits), phones (no sideways scroll at 390–1440px, tablets included), WCAG 2.1 AA (contrast ≥ 4.5:1 for text, keyboard, focus, reduced motion), the DummyJSON demo mode, existing accessible names/texts the unit tests and browser suites use (check `e2e/*.mjs`), honest data (no fake urgency).


> **Colours changed 2026-11-26 (palette A, the store owner's pick from six options shown on the real store):** emerald `#047857` (hover `#065f46`, strong `#064e3b`, soft `#ecfdf5`) replaces steel blue; orange `#f97316` (shapes only) with `#c2410c` for buttons, sale prices and small text (white 5.2:1) replaces coral-red; footer deep green `#0b2b22`; newsletter band `#064e3b` with a `#fdba74` subtitle; banner tones mint `#e6f4ee` / grey / beige / pink with a deep-orange `#9a3412` kicker (≥ 6.3:1 on every tone, because `#c2410c` is 4.46:1 on pink); the admin's tone label "Blue grey" is now "Mint". Layout unchanged. The table below is the original steel-blue theme. Checked: axe on 8 pages × 2 widths and Bangla (no violations), no sideways scroll, unit tests, slider / storefront / marketplace suites.

## Theme (done — `frontend/src/assets/styles/tokens.css`, `index.html`)

| Token | Value | Notes |
|---|---|---|
| `--color-primary` | `#417394` steel blue | buttons, links, prices, top bar; white text 5.1:1 |
| `--color-primary-hover` / `-strong` / `-soft` | `#355f7a` / `#2c5068` / `#eef3f7` | |
| `--color-secondary`, `--color-text` | `#222222` | titles and body |
| `--color-text-muted` | `#4a5568` | 7.1:1 on `#f8f8f8` |
| `--color-accent` | `#ff4f4f` coral-red | **shapes/large type only** (white text fails: 3.2:1) |
| `--color-accent-strong`, `--color-sale` | `#d32f2f` | red buttons ("Shop now" on banners, "Subscribe"), sale prices, badges (white 5:1) |
| `--color-bg-muted`, `--color-bg-tint` | `#f8f8f8` | tiles, image backgrounds, sections |
| `--color-border` | `#ececec` | |
| `--color-star` | `#ffb321` | |
| `--color-footer` | `#1d2328` charcoal | footer background; `--color-on-dark(-muted)` `#e8eaed` / `#b8bec7` |
| Radii | 5px buttons/inputs, 8px cards/tiles, 10px banners | |
| Shadows | almost none (flat) | hover: subtle border/shadow only |
| `--gradient-*` | now solid colours | **remove gradients from components** |
| Fonts | **Public Sans** (body and headings), Noto Sans Bengali for Bangla | loaded in `index.html` |

## What the reference looks like (to match)

- **Top bar:** solid steel blue, white text, ~42px: left a pin icon + delivery/store line, centre the promo message with an underlined link-style action, right language + currency dropdowns (ours: the existing top bar content, restyled).
- **Header:** white, ~100px tall, logo left (text logo, dark with a blue accent dot), **main navigation centred** (Home, Shop, categories… with chevrons for menus), icons right (wishlist/bookmark, cart with a small red count badge, account), thin dividers between icons; no heavy shadow; "All categories" mega menu kept.
- **Hero:** full-width **light grey (#f5f5f5-ish) background**, left text: small red uppercase kicker (letter-spaced), big bold uppercase dark title, grey subtitle, a **rectangular steel-blue button** with an arrow (5px radius); product image on the right. Slides/banners use light tinted backgrounds with **dark text** (not gradients, not white text). Slider controls restyled for a light background.
- **Category tiles:** a row of equal **light-grey square tiles** (8px radius) with a **line icon** (our lucide icons) centred above the lowercase/normal name; hover: steel-blue icon/border.
- **Section titles:** bold dark `#222` ~28px, left aligned, no kicker decorations (or a small one), "View all" on the right in steel blue.
- **Product cards:** **no card border/shadow**; image on a light grey/beige tile (8px radius) with a small white square wishlist icon button top-right; below, **centred** name (dark, medium weight) and price: sale price in **steel blue** then the original struck through in grey; rating stars optional; add/choose action appears on hover on desktop and stays visible on touch (our quick add / "Choose options" keep their names). **Changed 2026-11-26 at the owner's request:** every card shows a full-width text button under the price, "Add to cart" (filled, with a bag icon) or "Choose options" (outline), as in the first design; the small round "+" button is gone. Sale badge small red.
- **Promo banners:** light grey/beige backgrounds with dark text, a script-like accent line is optional (no new fonts beyond Public Sans — use italic/weight instead), **red "Shop Now" button** (`--color-accent-strong`, white text) with an arrow; mixed sizes in a row.
- **Compact product lists:** columns with a title and a **steel-blue underline segment** under the title over a grey hairline; rows: square grey thumbnail, name (truncated), stars + "(count)", price in steel blue.
- **Coupon banner:** solid steel-blue band, white bold title, a **dashed white bordered box** "Use code: XXX" (+ our Copy button).
- **Newsletter:** dark slate block (`#4a5568`-ish or charcoal) with white title, amber subtitle (`#ffb321`, check contrast on the dark background), white email field with an envelope icon and a **red Subscribe** button attached (keep our honest title).
- **Footer:** **charcoal `#1d2328`**, white headings, light grey links, columns: brand text + round social icons; About; Useful links; Categories; Store information (address, phone, email with icons); bottom row copyright left, payment badges right (ours: text badges, no brand logos).
- **Phones:** same flat style; bottom tab bar white with steel-blue active item.
- Product page, listing, cart, checkout, account: flat — white surfaces, `#ececec` borders, 5–8px radii, steel-blue buttons, no gradients/glows.

## Builders

- **A — shell and components:** tokens follow-ups, top bar, header (centred nav), mega menu, buttons/forms, product card, product page, listing, cart, checkout, account, mini cart, modals, toasts, footer, bottom tab bar, cookie banner, compare bar; remove every gradient/glow outside `components/home`.
- **B — home page:** `components/home/*`, `pages/HomePage.jsx`, `tones.css`: hero/slider light style (tone keys map to light tinted backgrounds: navy → light blue-grey, emerald → light grey, amber → light beige/peach, rose → light pink; dark text; red or blue buttons; controls readable on light), category tiles, section titles, deals band (flat), promo banners, tabs, compact lists, coupon banner, featured, recently viewed, benefits, brands, newsletter.
- The admin's colour labels may need renaming to match the new light tones (Ink / Indigo / Coral / Violet → e.g. "Blue grey / Grey / Beige / Pink") — builder B updates `admin/src/utils/homeSlides.js` labels only (keys unchanged) and `e2e/slider.mjs` if it selects a label.

## Implementation notes

(Each builder adds notes here.)

### Implementation notes — home page (builder B)

Files: `frontend/src/components/home/*` (CSS for every section; small JSX changes in HeroBanner, HeroSlider, PromoBanner, FeaturedCategories, BenefitsSection, DealsBand/HomeNewsletter comments), `pages/HomePage.jsx`, `admin/src/utils/homeSlides.js` (labels only), `e2e/slider.mjs` (the label it picks). No locale keys were added or changed; no accessible names changed.

- **Tones** (`tones.css`): the stored keys stay; they now mean flat light backgrounds with dark text — navy → blue grey `#e7eef3`, emerald → grey `#f2f2f2`, amber → beige `#f8eee4`, rose → pink `#fbeaec`. The admin's labels are now **Blue grey / Grey / Beige / Pink** (were Ink / Indigo / Coral / Violet); `e2e/slider.mjs` selects "Beige" (still stores `amber`). On the tints the brand's `#417394` and `#d32f2f` only reach ~4.3:1, so small text uses `--tone-kicker: #b3261e` (≥ 5.6:1) and `--tone-link: #2c5068` (≥ 7.3:1); the brand colours are only button backgrounds there (white text 5.1:1 / 5:1).
- **Hero** (single banner): `#f5f5f5` panel, red uppercase letter-spaced kicker, bold dark title, grey text, rectangular (5px) steel-blue button with an arrow (decorative icon, the name is unchanged), the second button outlined in ink; the photo on a white disc. The title is **not** CSS-uppercased (keeps names and screen-reader reading as typed).
- **Slider**: same copy style on the tones; flat white square-cornered Pause / Previous / Next with dark icons (steel blue on hover), progress bars `#5f6b78` (≥ 4.6:1 on every tone) filling steel blue, dark counter, the site's own focus ring (the white ring is gone). Behaviour, ARIA, inert slides and reduced motion are unchanged.
- **Hero row / promo banners**: flat (no shadow, 10px corners). Banners: tone background, an italic deep-steel accent line (the eyebrow), dark title, grey text, a **red** button (`#d32f2f`, white 5:1) with an arrow; no disc or drop shadow; a 4% photo zoom on hover (off with reduced motion).
- **Shop by category**: light grey (`#f8f8f8`) square tiles, 8px corners, the category's lucide line icon (stroke 1.5) above the name; hover: steel-blue border and icon. A category with **no icon of its own** (the generic tag) still shows its photo when known, so later categories keep a meaningful tile. Phones: a sideways-scrolling row inside the section; 4 per row from 640px, 6 from 900px. Unit tests updated accordingly (Marketplace / HomeSections: known slugs show the icon; an unknown slug with a photo shows the photo).
- **Section titles** (`home.css`): 28px bold `#222`, small red uppercase kicker without the bar, steel-blue "View all". Bangla: kickers have no letter-spacing (`:lang(bn)`).
- **Top products tabs**: plain text tabs on a grey hairline, the selected one steel blue with a 2px underline (focus ring drawn inside, not clipped).
- **Compact lists**: no card; title with a steel-blue underline segment over a grey hairline; rows with a square `#f8f8f8` thumbnail, the name on one line (ellipsis; the link keeps the full name), stars, price steel blue, original struck through.
- **Today's deals**: a white panel with a hairline border and a red top edge, the page's own heading colours, a flat red "Up to N% off" sticker (upright). No countdown (unchanged).
- **Coupon band**: solid steel blue, centred, white text, the code in a dashed white box, a white Copy button with steel-blue text; still only when the API sends an active coupon.
- **Featured products**: no longer on the grey `section--muted` band (white like the reference); carousel arrows flat white square-cornered.
- **Benefits / brands**: flat light grey tiles, steel-blue line icons in white squares; brand chips with square initials alternating steel blue / ink.
- **Newsletter**: dark slate block `#3d4654` (white title 9.5:1, amber `#ffb321` subtitle 5.3:1 — `#4a5568` would give amber only 4.2:1), white field box with an envelope (CSS background, our own SVG), red Subscribe attached; the form component is unchanged.
- Checked: no sideways scroll at 390, 768, 900, 1024, 1280, 1440px (English; Bangla at 390 and 1440), also with a coupon and five banners of every tone injected.

### Implementation notes — shell and components (builder A)

Files: CSS across `components/{layout,product,cart,ui,forms,common,orders,account,wishlist}`, `layouts/AccountLayout.css` and the page stylesheets (listing, product, cart, checkout, auth, account pages, wishlist, compare, CMS, orders, invoice, rewards, privacy, address book); JSX only in `components/layout/Footer.jsx` (column order) and `components/orders/OrderTotals.jsx` (one CSS import). One new locale key: `footer.storeInfo` ("Store information" / "দোকানের তথ্য") in `common.json` (en, bn). No accessible names, labels, headings or e2e-used class names changed; `ProductCard` props are unchanged.

- **Top bar**: solid steel blue, white 14px text (5.1:1), ~42px; white icons; the language switch and currency select restyled for the blue bar (white active option with deep-steel text); the coupon chip is a dashed white outline with a white "Copy" button (deep-steel text). No coral on the bar.
- **Header**: flat white, a hairline below, no blur/shadow (a faint shadow only when compact). Icons are plain (no round hover fill), 24px, with **thin vertical dividers** between them; count badges are **small red squares** (`--color-accent-strong`, white 5:1 — never white on `#ff4f4f`). The account link lost its pill border (label kept). Logo: no drop shadow. Search: flat grey box, 5px corners, square steel-blue button. We keep two rows (our search and "All categories" are features the reference lacks): logo · search · icons, then **"All categories" + the main navigation centred** in the rest of the row.
- **Main navigation**: plain text links (category icons hidden here — they stay in the mega menu; "Deals" keeps its icon and red), 2px steel-blue underline for the current page; 14px with 8px padding up to 1279px (fits one row at 1024 in English and Bangla), 16px with 12px padding from 1280px (custom properties `--nav-link-size` / `--nav-link-pad`). Sub-menus and the mega menu: 2px steel-blue top edge, light shadow, 8px bottom corners; the mega menu's featured tile is flat light grey with dark text and a red kicker (was a gradient with white text).
- **Buttons**: 5px corners, 1px border, weight 600, no shadow, no hover lift or press nudge; reduced motion removes the colour transition. Inputs/selects 5px corners.
- **Product card**: no border/shadow/lift; the photo on a flat `#f8f8f8` tile with 8px corners (images use `mix-blend-mode: multiply` so white photo backgrounds melt into the tile); brand, name, stars and price **centred**; price steel blue (5.1:1), original struck through in grey (no more red sale price). Wishlist/compare are **small white squares** (5px corners) top-right; badges small 3px rectangles (sale red, "New" steel blue). In the grid the quick add is a **square steel-blue button on the photo's bottom-right corner** (positioned with a container query: the card is `container-type: inline-size`, `top: calc(100cqw − …)`), "Quick view" beside it; on mouse devices both appear on hover **or keyboard focus within the card**, on touch they are always shown. Names unchanged ("Add to cart", "Sold out", "Quick view of …", "Choose options for …"). List layout: a hairline frame, left-aligned text, bordered toggles.
- **Listing**: flat grey category chips (steel blue when chosen), 28px title. **Product page**: gallery on a flat grey tile (no frame/shadow), thumbnails square-ish with a steel-blue active edge; title 24–32px; the price is no longer in a panel — steel blue with a hairline below (the "Save n%" stays red); section titles get a steel-blue segment over a grey hairline; perk icons without shadow. Quick view price steel blue.
- **Cart / mini cart / checkout**: the summary is a flat light-grey panel (no gradient edge/shadow); the total sits under a hairline with the amount in steel blue; free-shipping bar solid steel blue; checkout steps lost the gradient left bar and glow (focus-within: steel-blue border). Fix: `OrderTotals` now imports `CartSummary.css` — a checkout opened directly (without the cart chunk loaded) showed its summary unstyled.
- **Account / auth**: account header and profile card flat light grey (no coral radial glow), active nav item without shadow, auth card flat with a 3px steel-blue top edge. Panels across pages use 8px corners (`--radius-lg/xl` → `--radius-md` outside the home page); chips/pills that were fully round are 5px.
- **Footer**: flat charcoal `#1d2328` (no gradient edge or glows). Columns: brand + text + **round social icons** · the link groups · **Store information** (address, email, phone with icons). Bottom row under a hairline: copyright, language switch, cookie settings on the left; **"We accept" payment badges on the right** (small white cards, steel-blue icons). From 1280px all columns in one row (auto-flow, however many groups); 3 columns at 1024–1279, 2 from 640.
- **Bottom tab bar** flat white (hairline, faint shadow), steel-blue active text and 2px top bar, red square badge. **Cookie banner**: full-width strip on phones; from 768px a 28rem card in the bottom-right corner (same three equal buttons). **Compare bar**: charcoal. **Toasts**: charcoal, 5px corners. **Modals**: 8px corners, square close buttons. **Skeletons**: a flat pulsing grey block (no gradient sweep).
- No gradients or glows remain outside `components/home` (the `--gradient-*` / glow tokens stay defined for compatibility).
- Checked: no sideways scroll at 390, 768, 900, 1024, 1280, 1440px on home, listing (grid and list), product, cart, login, register, wishlist, compare; checkout and account at 1440 and 390; English and Bangla nav on one row at 1024–1440.

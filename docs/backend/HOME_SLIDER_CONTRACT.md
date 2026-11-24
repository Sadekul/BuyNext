# Home page: single banner or slider (contract)

**Status: built (2026-11-24).** Asked by the user: "Home page banner or slider both option we need. Admin can select whether they need a banner or a slider. Admin can create a slider."

Keeps every convention of phases 1–14: `snake_case` in the Laravel API, camelCase through the sign-in service (BFF), Laravel 422 errors by path, `content.view` to read and `content.edit` to save, audit entry on save (as the home page already does), English + Bangla for every shopper-facing text (Bangla fields optional, empty = English), the DummyJSON demo mode keeps working. **The default stays the single banner**, so every existing unit test and browser suite keeps passing unchanged.

## 1. Stored content (`settings.home_content`, `App\Services\HomeContent`)

New keys next to `hero`, `banners`, `featured_product_ids`:

- `hero_mode`: `"banner"` (default; today's hero) or `"slider"`.
- `slides`: list, **max 8**. Each slide:
  - `id` (like banner ids: lower-case letters, digits, dashes; generated `slide-xxxxxxxx` when empty; distinct)
  - `eyebrow` (≤60, optional), `title` (**required**, ≤120), `description` (≤300, optional)
  - `primary_cta`, `secondary_cta`: `{ label ≤40, url }` optional, same link rule as the hero (`/path` or `https://`)
  - `image_url` (optional, http(s), ≤2048), `image_alt` (≤160, optional)
  - `tone`: one of the banner tones (`navy|emerald|amber|rose`), the background when there is no image / behind the text; default `navy`
  - `is_active` (bool, default true), `position` (renumbered 0,1,2… on save like banners)
  - `bn`: `{ eyebrow, title, description, primary_cta_label, secondary_cta_label, image_alt }` all optional
- `slider`: `{ autoplay: bool (default true), interval_seconds: int 3–15 (default 6) }`.

Rules: when `hero_mode` is `slider`, at least one **active** slide is required → 422 on `slides`: "Add at least one active slide, or show the single banner instead." The single `hero` stays required and editable in both modes (switching back never loses it). `get()` returns the new keys with defaults when missing (old stored content without them = banner mode, no slides, default slider settings).

Migration (data only): adds `hero_mode: "banner"`, `slider` defaults and **three demo slides** (built from the demo store: e.g. new-season hero / laptops / fragrances, DummyJSON product images already used on the page, each with Bangla drafts) to stored content that has no `slides` key — so staff can switch to the slider and see it at once. Never overwrites existing slides. Extend `BanglaDemoContentSeeder` texts if helpful, same "only demo text, only empty fields" rule.

## 2. APIs

- `GET /api/admin/v1/home` / `PUT /api/admin/v1/home`: whole content incl. `hero_mode`, `slides`, `slider` (PUT replaces everything, like today; `hero_mode`/`slides`/`slider` optional on PUT → keep defaults, so old clients still work).
- `GET /api/v1/home` (public): adds `hero_mode`, `slides` (active only, by position, localized per field like banners — `bn` never sent), `slider`. If `hero_mode` is `slider` but no active slide exists, the answer says `hero_mode: "banner"` (the page never shows an empty slider).
- BFF (`frontend/server/adminSystemApi.js` + the Phase 13 Bangla mapping): `heroMode`, `slides[]` (`primaryCta`, `secondaryCta`, `imageUrl`, `imageAlt`, `isActive`, `bn.{eyebrow,title,description,primaryCtaLabel,secondaryCtaLabel,imageAlt}`), `slider.{autoplay, intervalSeconds}`, with the same field checks and error paths (`slides.0.title`) as the BFF does for banners. Storefront mapping of `GET /api/v1/home` likewise (camelCase).

## 3. Storefront

- Home page: `heroMode === 'slider'` with ≥1 slide → `HeroSlider`; otherwise today's `HeroBanner` unchanged.
- `HeroSlider` follows the WAI-ARIA carousel pattern: a `section` with `aria-roledescription="carousel"` and a label ("Featured" / Bangla); each slide `role="group"` `aria-roledescription="slide"` labelled "2 of 3" (Bangla digits per setting); Previous / Next buttons; one dot button per slide (`aria-current` on the shown one, label "Show slide 2"); a Pause / Play button when autoplay is on. Autoplay every `intervalSeconds`, **paused** while the pointer is over it or focus is inside it, and **off** with `prefers-reduced-motion: reduce`. While playing, the slide area is `aria-live="off"`; when paused/stopped `polite`. Keyboard: all controls are buttons (Tab order: content links, then controls); Left/Right arrows on the controls change slides. Touch swipe on phones. One slide → no controls, no autoplay. Inactive (hidden) slides are not focusable (`inert` or `hidden`).
- Each slide looks like the current hero (eyebrow, title, description, up to two buttons, image) on its tone background; first slide image `loading="eager"` + `fetchpriority="high"`, the others lazy. No layout shift between slides (fixed height per breakpoint). Fits 390px with no sideways scroll.
- All new UI strings in `locales/en` and `locales/bn` (same keys, same variables).
- Demo mode (`data/homeContent.js`): stays banner mode (may include demo slides for unit tests).

## 4. Admin (Content → Home page)

- New section **"Top of the home page"** first on the page: radio group **Single banner** / **Slider** (with a one-line hint each). The existing hero form is shown for "Single banner"; the slides editor for "Slider" (both are kept and saved; only the chosen one is shown on the store).
- **Slides editor:** list of slides (title, active badge, image thumbnail), **Add slide** (up to 8; button disabled with a hint at 8), per slide: edit all fields (English + "in Bangla" fields, like the banners' Bangla fields), tone select, Active checkbox, **Move up / Move down**, **Delete** (confirm dialog). Slider settings: "Play automatically" checkbox and "Seconds per slide" (3–15).
- Client checks mirror the API (title required, link rule, max 8, ≥1 active slide in slider mode) with errors next to fields; server errors by path shown on the right field. Viewer role (`content.view` only) sees everything read-only.
- Saving uses the existing Save of the page (whole content), with the existing success / audit behaviour.

## 5. Tests

- Backend feature tests: defaults for old stored content; validation (title required, max 8, link rule, interval 3–15, slider mode needs an active slide); public answer (active only, order, Bangla per field, fallback to banner when no active slide); migration demo slides present and Bangla filled; audit entry on save.
- Storefront unit tests: HomePage picks slider/banner; HeroSlider controls, labels, autoplay pause on hover/focus, reduced motion, one-slide case, Bangla labels.
- Admin unit tests: mode switch, add/edit/move/delete slide, max 8, validation messages, read-only viewer.
- Browser (`e2e`, by the lead after the agents): admin switches to Slider, adds a slide, saves; the store shows the slider with working controls, pause, axe clean, 390px fits, Bangla; switch back to banner restores the hero; cleanup puts the content back.

## Implementation notes

(Each agent adds its notes here when done: choices made where this page left something open.)

### Implementation notes — backend

- **Where:** `App\Services\HomeContent` (rules, messages, normalize, get, forStorefront, `localizeSlide`), data migration `2026_11_24_000300_add_home_slider.php`, slide drafts in `BanglaDemoContentSeeder::HOME_TEXTS` (also listed in `docs/I18N.md`), tests in `tests/Feature/HomeSliderTest.php`.
- **PUT without the new keys** stores the defaults (`hero_mode: "banner"`, `slides: []`, `slider: {autoplay: true, interval_seconds: 6}`). PUT still replaces everything, so an old client that omits `slides` drops them: the admin must always send `slides` back.
- **Validation paths/messages:** `hero_mode` (`in`); `slides` ("The slider has at most 8 slides." / "Add at least one active slide, or show the single banner instead." — also when `slides` is missing or `[]` in slider mode); `slides.N.title|eyebrow|description|image_url|image_alt|tone|id|position|is_active`; `slides.N.primary_cta.url` / `slides.N.secondary_cta.url` (link rule message as for the hero); `slides.N.primary_cta.label` (required with the cta); `slides.N.bn.*`; `slider.autoplay` (boolean); `slider.interval_seconds` ("Show each slide for 3 to 15 seconds."). Ids must be distinct (`slides.N.id`). `is_active` `false`/`0`/`"0"` counts as inactive.
- **Defaults on save:** empty `id` → `slide-xxxxxxxx`; missing `tone` → `navy` (not required, unlike banners); missing `is_active` → `true`; positions renumbered 0,1,2… after sorting by the sent `position` (missing = its index; ties keep the sent order); `bn` is `null` when no Bangla field is filled, otherwise all six keys (empty = `null`).
- **Migration:** adds the three demo slides (`new-season` navy, `workday-laptops` emerald, `signature-fragrances` rose; AirPods Max / MateBook X Pro / Chanel Coco Noir DummyJSON images) when the stored `slides` is missing **or empty** (the Phase 13 Bangla migration already re-saves the content with `slides: []` on a fresh install), then runs `BanglaDemoContentSeeder` to fill their `bn`. `hero_mode` stays `banner`. `down()` removes only those three ids.
- **Public `GET /api/v1/home`** (`data`):

```json
{
  "hero_mode": "banner | slider",
  "hero": { "eyebrow", "title", "description", "primary_cta": {"label","url"} | null, "secondary_cta": … | null, "image_url", "image_alt", "highlights": [] },
  "banners": [ … ],
  "slides": [
    { "id": "new-season", "eyebrow": "…", "title": "…", "description": "…",
      "primary_cta": { "label": "Shop now", "url": "/products" } | null,
      "secondary_cta": { "label": "Explore deals", "url": "/deals" } | null,
      "image_url": "https://…" | null, "image_alt": "…" | null,
      "tone": "navy|emerald|amber|rose", "position": 0, "is_active": true }
  ],
  "slider": { "autoplay": true, "interval_seconds": 6 },
  "featured_products": [ … ]
}
```

  `slides` holds active slides only, by position, localized per field for `Accept-Language: bn`, no `bn` key. `hero_mode` is `"banner"` whenever no active slide exists. `slides` is always sent (also in banner mode), so the store must use `hero_mode` to choose, not the presence of slides.
- **Admin `GET`/`PUT /api/admin/v1/home`** (`data`): `{ hero_mode, hero, banners, slides, slider, featured_product_ids, featured_products }` — `slides` are all slides (inactive too), each with the fields above plus `bn: { eyebrow, title, description, primary_cta_label, secondary_cta_label, image_alt } | null`. `hero_mode` is the stored value (may be `slider` with no active slide only if stored outside the API).
- **Audit:** the existing `home.updated` entry lists `hero_mode`, `slides`, `slider` among the changed keys.

### Implementation notes — storefront

- **Mapping** (`frontend/src/services/adapters/contentAdapter.js`, `normalizeHome`): adds `heroMode`, `slides`, `slider`. `heroMode` is `"slider"` only when `hero_mode === "slider"` **and** at least one usable slide remains, otherwise `"banner"` (old answers without the keys = banner). Slides keep the storefront's existing prop names, the same as the `HeroBanner` `content` prop: `{ id, eyebrow, title, description, primaryCta: { label, to } | null, secondaryCta, image, imageAlt, tone }` (so `image_url` → `image`, not `imageUrl`; `primary_cta.url` → `to`, through the same `safeLinkTarget` link check as the hero, so `javascript:` links become no button). Inactive or title-less slides are dropped and the rest sorted by `position` defensively; unknown tones → `navy`. `slider` → `{ autoplay (default true), intervalSeconds (default 6, clamped to 3–15) }`. `frontend/server/catalogApi.js` passes `/api/v1/home` through unchanged (only its doc comment changed).
- **Component**: `frontend/src/components/home/HeroSlider.jsx` + `.css`, reduced-motion hook `frontend/src/hooks/useReducedMotion.js`. `HomePage` (REAL_SHOP only) renders `HeroSlider` when `heroMode === 'slider'` and `slides.length ≥ 1`, else `HeroBanner` unchanged. Demo mode (DummyJSON) stays banner mode; `data/homeContent.js` is unchanged.
- **Headings**: slide titles are `h2`; the slider carries a visually hidden `h1` with the store name (store settings `storeName`, else "BuyNest"), like the hero's loading state, so the page always has exactly one h1.
- **Hidden slides**: all slides are stacked in one CSS grid cell (the slider is as tall as its tallest slide, with a min-height of 36rem / 30rem ≥768px / 32rem ≥1024px), so nothing moves when slides change. Hidden slides get `inert` and `visibility: hidden` (fade with opacity, instant under reduced motion via base.css).
- **Controls order** (after the slide content in the DOM / Tab order): Pause/Play (only when autoplay can run), Previous, the dots (wrapped in a `group` labelled "Choose a slide"), Next. All carry `aria-controls="hero-slider-slides"`. Previous/Next wrap around. Left/Right arrows on any control change the slide; on a dot, focus moves to the new current dot.
- **Autoplay**: runs only with ≥2 slides, `autoplay: true` and no `prefers-reduced-motion: reduce`; otherwise there is **no Pause/Play button** and `aria-live` is `polite`. Paused while the pointer is over the section or focus has entered it (until focus leaves the section); pressing **Play** resumes immediately, even with the pointer/focus still on the button. The Pause/Play button reflects the visitor's choice, not the temporary hover/focus pause. The live region (`#hero-slider-slides`) is `aria-live="off"` only while actually rotating. Any slide change restarts the interval.
- **Swipe**: horizontal swipe ≥50px (more horizontal than vertical) on the slide area → next/previous.
- **Images**: slide 1 `loading="eager"` + `fetchpriority="high"`, others `loading="lazy"`; all `width/height 560` (square, reserved). A slide without an image uses the full width for its text.
- **390px**: buttons wrap their labels, titles break long words, and the control row is 336px with 8 slides (3 × 40px buttons + 8 × 24px dot targets), so it stays on one line.
- **Accessible names for the browser test** (strings in `locales/{en,bn}/marketing.json` → `home.slider.*`; digits follow the Bangla-digits setting, shown here with it on):

  | What | English | Bangla |
  |---|---|---|
  | Carousel (`region`, `aria-roledescription`) | name "Featured", roledescription "carousel" | "বিশেষ আকর্ষণ", "ক্যারোসেল" |
  | Slide (`group`, `aria-roledescription`) | "1 of 3", "2 of 3"…, roledescription "slide" | "৩টির মধ্যে ১", "৩টির মধ্যে ২"…, "স্লাইড" |
  | Previous / Next (`button`) | "Previous slide" / "Next slide" | "আগের স্লাইড" / "পরের স্লাইড" |
  | Pause / Play (`button`) | "Pause slides" / "Play slides" | "স্লাইড থামান" / "স্লাইড চালান" |
  | Dot (`button`, `aria-current="true"` on the shown one) | "Show slide 1", "Show slide 2"… | "স্লাইড ১ দেখান", "স্লাইড ২ দেখান"… |
  | Dots group (`group`) | "Choose a slide" | "একটি স্লাইড বেছে নিন" |

  With Bangla digits off: "৩টির মধ্যে 1", "স্লাইড 2 দেখান". Playwright: `page.getByRole('region', { name: 'Featured' })`, `getByRole('button', { name: 'Next slide' })`, `getByRole('group', { name: '2 of 3' })` (hidden slides are `visibility: hidden`, so only the shown slide matches by role).
- **Tests**: `frontend/src/components/home/HeroSlider.test.jsx` (14: labels/roles, inert slides, image loading, Previous/Next/dots + `aria-current`, Tab order, arrow keys, autoplay + Pause/Play + `aria-live`, hover pause, focus pause, reduced motion, autoplay off, one slide, swipe, Bangla with and without Bangla digits) and `frontend/src/pages/HomeSlider.laravel.test.jsx` (6: HomePage picks slider / banner / old answer / empty slider; `normalizeHome` mapping and defaults).

### Implementation notes — admin

- **BFF** (`frontend/server/adminSystemApi.js` `validateHome`, `frontend/server/shop/adminSystem.js` `homeContent` / `homeSlide` / `toHomeBody`, Bangla tables in `frontend/server/shop/adminPhase13.js` (`BANGLA_FIELDS.slide`, `toSlideBangla`) and `frontend/server/adminPhase13Api.js` (`BANGLA_LIMITS.slide`, image description ≤160)). GET always answers `heroMode` (`"banner"` unless the API says `"slider"`), `slides` (all, sorted by `position`, each `{ id, eyebrow, title, description, primaryCta|null, secondaryCta|null, imageUrl, imageAlt, tone (unknown → navy), position, isActive, bn: { eyebrow, title, description, primaryCtaLabel, secondaryCtaLabel, imageAlt } }` with `''` for empty / `bn: null`) and `slider: { autoplay (default true), intervalSeconds (default 6) }`. PUT sends `hero_mode`, `slides` (list order = `position` 0,1,2…; empty ctas → `null`; `id` only when it is a valid slug) and `slider: { autoplay, interval_seconds }` **when the admin sent them** — the admin app always sends all three, so the API never drops the slides. The API's 422 paths come back camelCase (`slides.0.primaryCta.url`, `slides.0.bn.primaryCtaLabel`, `slider.intervalSeconds`, `heroMode`).
- **BFF checks** (422 before any call, paths like the banners): `heroMode` in banner|slider; `slides` array of ≤8; per slide `title` 1–120, `eyebrow` ≤60, `description` ≤300, ctas optional but when given label 1–40 and a link (`/path` or `http(s)://`), `imageUrl` `''` or `http(s)://` ≤2048 (**a store path like `/images/x.png` is refused for slides**, unlike the hero), `imageAlt` ≤160 and **required when there is an image** (same as banners/hero; stricter than the API), `tone` missing → navy, unknown → "Choose a color."; `bn.*` lengths; slider mode needs an active slide (`slides`); `slider.autoplay` boolean, `slider.intervalSeconds` integer 3–15.
- **Admin page** (`admin/src/pages/HomeEditorPage.jsx`, new `admin/src/components/HomeSlides.jsx` (`HeroModeChoice`, `SlidesEditor`, `BanglaGroup` moved here), `admin/src/utils/homeSlides.js` (form values, client checks, what is sent), `SLIDE_BANGLA_FIELDS` in `admin/src/utils/bangla.js`, styles at the end of `admin/src/admin.css`). "Top of the home page" is a `radiogroup` labelled by its panel heading. Single banner shows the Hero panel; Slider shows the Slides panel instead (the hero panel is `hidden`, still kept and saved). A problem in the part not shown says so in the page's alert ("…choose “Single banner” to see it" / "…choose “Slider” to see it"). Saving always sends `heroMode`, `slides`, `slider` with the hero, banners and featured products.
- **Slide field names** carry the slide's number in a visually hidden prefix, so each is unique and the visible label stays short. Moving or deleting clears field errors (they are numbered by position). Deleting asks first (`ConfirmDialog`); focus then goes to **Add slide**. Moving keeps focus on the moved slide's arrow (as for banners).
- **Accessible names for the browser test:**
  - Radio group: `radiogroup` "Top of the home page"; radios "Single banner", "Slider".
  - Panel heading "Slides"; button "Add slide" (description "N of 8 slides."; disabled at 8 with "8 of 8 slides, the most the slider holds. Delete one to add another.").
  - Each slide is a `group` named "Slide N: {title or New slide} Active|Inactive".
  - Slide fields (N = 1-based position): "Slide N: Title", "Slide N: Eyebrow (small text above the title)", "Slide N: Description", "Slide N: Main button text (optional)", "Slide N: Main button link", "Slide N: Second button text (optional)", "Slide N: Second button link", "Slide N: Image address", "Slide N: Image description (alt text)", "Slide N: Color" (select: Navy / Emerald / Amber / Rose), checkbox "Slide N: Active (shown in the store)".
  - Bangla: "Slide N: title in Bangla", "Slide N: eyebrow in Bangla", "Slide N: description in Bangla", "Slide N: main button text in Bangla", "Slide N: second button text in Bangla", "Slide N: image description in Bangla".
  - Buttons: "Move slide N up", "Move slide N down", "Delete slide N"; dialog "Delete slide N?" with "Cancel" / "Delete slide".
  - Slider settings (`group` "Slider settings"): checkbox "Play automatically", number "Seconds per slide".
  - Save: "Save home page" (success text starts "Home page saved."); viewers see "Your role can view the home page but not change it." and every control disabled.
- **Client messages** (mirror the API): "Enter a title.", "Enter the button text.", "Enter where the button goes.", "Use a store path like /products or an https:// address.", "Use an https:// image address.", "Describe the image for people who cannot see it.", "Add at least one active slide, or show the single banner instead.", "Choose 3 to 15 seconds.". Server messages (e.g. "Show each slide for 3 to 15 seconds.") replace them on save. A server error on `slides.N.id` has no field and only shows in the page alert.
- **Tests:** `frontend/server/api.adminHomeSlider.test.js` (7: GET mapping + old content defaults, PUT mapping, old client sends no new keys, field checks by path, max 8 / active slide / interval, API 422 paths) and `admin/src/pages/HomeSlider.test.jsx` (6: mode switch + add/edit + Bangla + settings + save, move/delete with confirm, max 8, client validation linked with aria-describedby, server errors on the right field incl. hidden-part notice, read-only viewer). Existing Phase 4 / Phase 13 home tests unchanged and passing.

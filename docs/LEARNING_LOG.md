# BuyNest learning log

## Phase 1: Environment and project setup

- What Vite is: an ES-module dev server with HMR plus a production bundler
- How React boots: `index.html` → `<script type="module" src="/src/main.jsx">` → `createRoot().render(<App />)`
- ES modules: default vs named `import`/`export`
- npm scripts, `package.json`, and the lockfile
- ESLint flat config: core rules, Rules of Hooks, react-refresh
- `VITE_` environment variables and why they are public
- `.gitignore`, and keeping `.env.local` out of Git

## Phase 2: Components and frontend template

- JSX rules: single root or fragment, `className`, `{}` expressions, self-closing tags
- Functional components, plus class equivalents in `src/learning/`
- Composition: `MobileNavigation` reuses `Modal` and `SearchBar`; `ProductSection` = `SectionHeading` + `ProductGrid`
- Props: destructuring, defaults, objects and arrays as props, and function props (`onAddToCart`, `onClose`, `onRetry`)
- `children` props: `EmptyState` actions, `Modal` body
- Conditional rendering: `&&`, ternaries, early `return`
- Lists with `map()` and stable keys (`product.id`, `slug`); when index keys are acceptable
- Events: `onClick`, `onChange`, `onSubmit` + `preventDefault()`
- State introduced where needed: `useState` (menu, newsletter, toast); state lives in the closest common parent
- `useEffect` with cleanup (`Toast` timer), `useRef` (`Modal`'s dialog), `useId` (unique form ids), `useCallback` (stable `onDismiss`)
- React Router basics: `BrowserRouter`, nested `Route`s with `Outlet`, `Link` vs `NavLink`, `useNavigate`
- How React updates the DOM: render → compare with the previous output → patch only what changed

## Phase 3: External API integration

- REST, JSON, HTTP methods (GET/POST/PUT/PATCH/DELETE) and status codes (200, 201, 400, 404, 429, 5xx)
- `fetch()`: it resolves on 4xx/5xx, so we check `response.ok`; it rejects only on network failure or abort
- Promises, `async`/`await`, `try`/`catch`, and response parsing with `response.json()`
- Request headers (`Accept`, `Content-Type`), query parameters with `URLSearchParams`, and where auth headers will go
- CORS: DummyJSON returns `Access-Control-Allow-Origin`, so the browser allows our requests
- `AbortController` and `AbortSignal.timeout`/`AbortSignal.any`: cancel stale requests and enforce timeouts
- A service layer + an adapter (normalization) layer, so components don't depend on one API's shape
- Custom hooks (`useFetch`, `useProductList`): loading, error, empty, retry, and load-more states
- `useEffect` cleanup to prevent stale responses from overwriting newer ones; StrictMode's double effect in development
- `useEffectEvent`: read the latest values in an effect without making them dependencies
- Event-driven fetching (playground buttons, "load more") vs effect-driven fetching (data a page needs to show)
- Server-side search, category, sorting, and pagination; URL search params as state (`useSearchParams`)
- Fetch vs Axios: Axios adds `baseURL`, automatic JSON, throwing on 4xx/5xx, timeouts, and interceptors

## Phase 4: Product listing and catalog

- Server-side vs client-side filtering, and why filters must see the full set
- Derived state: compute filtered/sorted/paginated lists during render instead of storing them
- Controlled inputs for every filter (number, radio, checkbox) owned by one parent
- Immutable updates with spread, `filter`, and `toSorted` (never `sort` on state)
- Resetting a subtree's state with the `key` prop
- Component communication through function props (filters, sort, view, pagination, quick view)
- Accessible controls: `fieldset`/`legend`, `aria-pressed`, `aria-expanded`, `aria-current="page"`

## Phase 5: Product details page

- Dynamic routes (`:productId`) and `useParams` (params are strings — validate them)
- Route-based data fetching keyed by the URL; 404 handling with `ApiError.status`
- Component reuse across same-route navigation, and resetting state with `key`
- `Link` vs `NavLink` vs `useNavigate` (`navigate(-1)`, `location.key`)
- React 19 `<title>` in components for per-page document titles
- Real business rules from data (minimum order quantity vs stock); not inventing variants

## Phase 6: Shopping cart

- Lifting state, prop drilling, and when to switch to Context
- Context API (`createContext`, React 19 `<Context value>`, `useContext` in a guarded custom hook)
- `useReducer` with action types; a pure reducer that enforces all quantity rules
- Immutable updates for nested arrays/objects (`map`, `filter`, spread)
- Lazy state initialization, `localStorage` sync in an effect, validation of stored data, cross-tab `storage` events
- `useMemo`/`useCallback` to keep a context value stable
- Money in integer cents; explicit shipping and coupon rules; why the backend must re-validate

## Phase 7: Wishlist

- Extracting reusable hooks (`usePersistentReducer`, `useProductRefresh`): hooks share logic, not state
- Context-connected components (`WishlistButton`) vs function props
- Provider nesting order when one provider uses another
- Keeping reducers pure (timestamps created in handlers, passed in actions)
- Preventing duplicates in the reducer and when loading from storage

## Phase 8: Search, filtering, and sorting

- Debouncing with `setTimeout` + effect cleanup (`useDebouncedValue`); debounce vs throttle
- Client-side vs server-side searching
- URL search params as the single source of truth (`replace` vs push history entries; validating URL input)
- `useMemo` for expensive derived data and stable object identity; when not to use it
- React Router transitions vs controlled inputs (`useTransitions={false}`)
- Accessible combobox (search suggestions), removable filter chips, mobile filter drawer

## Phase 9: User registration and authentication

- Authentication vs authorization; session cookies vs bearer tokens
- Access and refresh tokens; refresh-and-retry on 401; expired sessions
- 401 vs 403 (and DummyJSON's 400 for bad credentials)
- Protected and guest-only layout routes with `<Navigate>` and `state.from`
- Client-side validation with touched/submitted state, focus management, `aria-invalid`/`aria-describedby`; why the server must validate too
- Allow-listing user fields to keep sensitive data out of state and storage
- Cross-tab sign-out with the `storage` event (and the remove-then-set bug it exposed)
- Production plan: Laravel Sanctum with HttpOnly, Secure, SameSite cookies + CSRF

## Phase 10: Checkout and order management

- React Hook Form (`register`, `handleSubmit`, `useWatch`, `setError('root.…')`, `isSubmitting`, focus on error)
- Zod schemas: formats, enums, nested objects, conditional rules with `superRefine`; `zodResolver`
- Controlled vs uncontrolled inputs; validation timing (on submit, then on change) and why on-blur errors can swallow clicks
- Nested forms are invalid HTML; the `form` attribute on a submit button
- Server-side verification of prices, stock, discounts, shipping, taxes, and totals; never handling card data
- Order history scoped to the signed-in customer (and IDOR on the server)

## Phase 11: Advanced React

- Every hook mapped to real code, including `useEffectEvent` and `useSyncExternalStore`
- Class lifecycle methods vs hooks; error boundaries (`getDerivedStateFromError`, `componentDidCatch`, reset by `key`)
- Controlled vs uncontrolled components; refs for DOM access only
- `React.memo` with stable props, `useMemo` vs `useCallback`, when not to optimize
- `React.lazy` + `Suspense` route code splitting; lazy images and `fetchPriority`
- When list virtualization is (and isn't) needed; React DevTools and the Profiler
- TanStack Query: query keys/options, caching, `isPending` vs `isFetching`, invalidation, background refetching, mutations, optimistic updates with rollback, retry policy
- Server state vs client state

## Phase 12: Admin backend integration (frontend side)

- Provider + adapter (anti-corruption) layer; switching backends with `VITE_API_PROVIDER`
- Designing a REST contract: envelopes, pagination meta, error format, decimal-string money
- Parallel requests with `Promise.all` for paginated "fetch all" scopes
- Sanctum SPA auth: `credentials: 'include'`, CSRF via `XSRF-TOKEN` → `X-XSRF-TOKEN`, 419
- Mapping server 422 validation errors onto form fields
- Admin → API → MySQL → storefront flow; backend-enforced permissions; Shopify/Magento public vs private APIs

## Phase 13: Testing and debugging

- Vitest + jsdom + React Testing Library + user-event + jest-dom setup
- API mocking at the `fetch` boundary; fixtures from an offline data snapshot
- Unit (reducers, utils, schemas, API client, adapter), component, and integration tests
- Role/label queries, `find*` for async UI, testing behavior instead of implementation
- Loading, error, empty, validation, and protected-route tests; basic accessibility assertions
- Proving tests catch bugs by breaking code on purpose
- Debugging: console, breakpoints, Network tab, React DevTools, Profiler, storage, `screen.debug()`

## Phase 14: Deployment

- Production build vs dev server; `npm run preview`
- Build-time environment variables and dead-code elimination (learning lab excluded)
- SPA fallback routing (Vercel rewrites, Netlify `_redirects`, Nginx `try_files`)
- Asset hashing and caching headers; basic security headers
- Automated accessibility audit with axe-core (label-in-name, heading order)
- Release checklist

## Backend phase 1: Real accounts (Laravel + MySQL)

- Laravel basics: routes, controllers, form requests (validation), migrations, models, seeders, Artisan commands (`buynest:create-admin`)
- Two separate account types (`customers` and `admins` tables) so a customer can never sign in to the admin
- Laravel Sanctum token pairs: a short access token (60 minutes) plus a rotating refresh token; "remember me" makes the refresh token last longer
- Middleware order: the token-kind check (`token.kind:customer|admin`) runs before route model binding, so a customer token can't learn which admin ids exist
- Email one-time codes: stored as an HMAC hash, expire after 10 minutes, lock after 5 wrong tries, resend at most once a minute
- A backend-for-frontend (the store's own `/api/*` server functions): tokens live in HttpOnly cookies the browser's JavaScript can't read
- React side: multi-step forms (Register → Verify email, two-step Forgot password), mapping server 422 errors onto fields, safe redirects after sign-in (`utils/safeRedirect.js`), a separate admin session provider
- Rate limiting per IP and per email; trusting the client IP only from the sign-in service (shared key)

## Backend phase 2: Catalog and real orders

- Importing the DummyJSON catalog into MySQL while keeping product ids, so links keep working
- Money as whole cents on the server, shown as 2-decimal strings in the API
- The server is the source of truth for prices: the browser sends what it expects to pay, and the server answers 409 if the total changed
- Database transactions and row locks (`lockForUpdate`) so two shoppers can't buy the last item twice
- Guest checkout and order lookup by order number + email
- React side: switching the data source with `VITE_API_PROVIDER`, cart validation before placing the order, TanStack Query invalidation after an order

## Backend phase 3: Invoices, shipments, refunds, coupons

- Magento-style sales documents: invoice (INV-), shipment (SHP-, carrier tracking links), credit memo (CM-)
- Partial refunds: splitting a coupon discount across lines in proportion, restocking returned items
- Coupons stored in the database with a row lock so a limited coupon can't be used beyond its limit
- Data backfills with a migration (invoices for orders paid before invoices existed) and guards against double invoicing
- React side: admin dialogs for invoice, ship, and refund with live totals; a printable invoice page

## Backend phase 4: Roles, audit log, content, reports, settings

- Role-based access control: permission keys per area and action, checked by `can.admin:<key>` middleware on every admin route, with a test that fails if a route has none
- Preventing privilege escalation: only an Owner can grant the Owner role; there is always at least one active Owner
- An audit log of admin changes that never stores passwords or tokens
- Sanitizing user-entered HTML on the server with an allow-list (symfony/html-sanitizer)
- Reports with date ranges and grouping; CSV download with a guard against spreadsheet formula injection
- A cached settings service: shipping, tax, countries, payment methods, guest checkout, applied by the store immediately
- React side: hiding navigation and buttons the role can't use (`can()` in `AdminAuthProvider`) while the server still refuses, a "You don't have access" screen for 403, accessible charts as tables, a home page editor with banner reordering

## Backend phase 5: Magento-style catalog

- Trees in a relational database: `parent_id`, depth limits, refusing cycles, "visible only when every ancestor is active", and including descendants in a category listing
- File uploads safely: trusting the file's contents (finfo + getimagesize), never its name or the browser's type; random file names; serving files through an allow-listed route on the store's own origin
- Multipart requests through a backend-for-frontend: passing the body through with its boundary, and size caps that stop reading early
- Modeling configurable products: options, values, and variants with their own SKU, price, and stock; keeping old orders linked by deactivating instead of deleting
- All-or-nothing bulk changes and CSV imports in one transaction, with a dry run that reports errors per row
- Moderation workflows: pending → approved/rejected, recomputing averages from approved rows only
- React side: accessible option pickers (radio groups in fieldsets), cart lines keyed by product + variant with a backward-compatible saved shape, `FormData` uploads, keyboard-friendly reordering (move up/down buttons instead of drag only), a bulk-selection bar
- Testing lesson: browser suites that share one database must never run at the same time, and must clean up in a `finally` block

## Backend phase 6: Magento-style customers and sales

- Ownership checks: a customer can only see and change their own addresses and returns (another customer's id answers 404, not 403, so ids don't leak)
- Pricing layers in a fixed order: product discount → customer group discount → coupon; storing the amounts on the order so later refunds use what was actually charged
- Reusing one checkout service for the storefront and for staff-created (phone) orders, with a "quote" that prices without saving
- State machines: return statuses with allowed moves, refused moves answered with 422, and side effects (emails, history notes) on each move
- Preventing double effects: restocking once whether it happens on receipt or on refund
- Partial success in bulk actions: each order in its own transaction, answered with done and skipped lists
- Account lifecycle: staff-created accounts get a "set your password" code instead of a password; changing an email unverifies it and signs the customer out
- React side: tabs with arrow-key navigation (ARIA tabs pattern), print pages with print-only CSS, pre-filling forms from saved data, showing server-calculated totals instead of recalculating in the browser

## Backend phase 7: Magento-style marketing and system

- Rule engines for prices: matching by customer group, category tree, product, and dates; priorities and "stop further rules"; "best price wins" and never below a floor; caching active rules and clearing the cache when rules or categories change
- Discounts that refunds can trust: spreading a cart discount over eligible lines only and storing each line's share
- Privacy-safe forms: a newsletter sign-up that answers the same for known and unknown emails, double opt-in, signed unsubscribe links, `List-Unsubscribe` headers
- Queued jobs in batches for bulk email, and why jobs dispatch after the database commit
- Template systems with a fixed variable list: escaping inserted values, refusing unknown variables, requiring the variables an email can't work without (a code or a link)
- SEO basics: titles, meta descriptions, canonical links, Open Graph tags, sitemap.xml and robots.txt, 301 vs 302 redirects
- Counting search terms without storing who searched (hashed IP kept only in a short-lived cache)
- Syncing state across devices without double counting: merging a saved cart exactly once per sign-in, with a per-device record and a cross-tab lock
- Admin UX patterns: a notifications bell (polling paused in hidden tabs, popover focus management), saved grid views, previewing user HTML in a sandboxed iframe
- Coordination lesson: two agents sharing one test database must not run tests at the same time

## Phase 8: Card payments, real email, hosting

- Hosted payment pages: why card numbers should never touch your own servers (PCI), and how Stripe Checkout hands the shopper back with success and cancel URLs
- Webhooks: verifying a signature over the raw body (HMAC-SHA256, constant-time compare, a time window against replays), handling each event once, and never trusting the browser's "success" page as proof of payment
- Idempotency keys so a retried request never charges or refunds twice
- Calling a third-party API inside a database transaction: ask the provider first, save only if it agreed
- Testing payments without the provider: a stand-in server, separate test copies of the API and store with their own settings, and webhooks signed by the test itself
- Email delivery: SMTP providers, SPF, DKIM, and DMARC, and sending a test email from the command line
- Containers for PHP: nginx + PHP-FPM, running as a non-root user, a startup script per role (web, queue worker, scheduler), persistent volumes for uploads
- Locking an API to its own front end with a shared key, while health checks and public files stay open

## Phase 9: Launch readiness and customer self-service

- Two-step sign-in (TOTP, RFC 6238): shared secrets, 30-second steps, a ±1 step window, replay guards, recovery codes stored as hashes, a short-lived challenge between the password and the code, and a limited "set it up first" session when the store requires two-step
- Image processing on upload: resizing without upscaling, re-encoding to strip metadata, `srcset`/`sizes` so phones download small files
- Observability: reporting server and browser errors (scrubbing personal data first), sendBeacon for errors on a closing page
- Backups you can trust: consistent dumps (`--single-transaction`), keeping passwords off the command line, retention, alerts on failure, and actually testing a restore
- Privacy by design: changing an email only after the new address proves itself, telling the old address, data export, and account deletion that keeps the shop's accounting records without the person
- Event-driven notifications: one model hook for "back in stock" instead of a call in every place stock changes
- Testing lessons: waiting for focus that moves on the next animation frame; longer limits for long flows when the whole suite runs in parallel

## Phase 10: Search, PDFs, PayPal, shipping rates, gift cards, analytics

- Search relevance in MySQL: FULLTEXT indexes, ranking tiers (exact SKU, exact name, prefix, contains), and typo correction with an edit-distance vocabulary that never "corrects" a real word
- Server-side PDFs with dompdf: no remote resources, embedded fonts, font subsetting for small files, attaching documents to emails
- A second payment provider behind the same design: OAuth client credentials, server-side capture after the shopper returns, webhook verification through the provider's API, one idempotency table for every provider
- Table-based shipping rules: matching by country, weight, and order value, and keeping cart, checkout, and staff orders on the same calculation
- Stored value done safely: gift card codes stored as hashes, balances changed only under row locks, every movement recorded, refunds returned to the card first
- Privacy-first analytics: consent before any tracking script loads, Consent Mode v2, events without personal data, a CSP that only allows the analytics hosts when analytics is built in
- Testing lessons: wait for the app's own "busy" signals (a debounced price check) instead of clicking a briefly disabled button; compare counts with the API instead of hard-coding them

## Phase 11 (backend): Wishlists, comparison, linked products, reward points, display currencies

- Moving client state to the server without losing it: optimistic updates with rollback, and merging a guest's browser list into the account exactly once per sign-in
- Shareable links done privately: a random token shown once and stored only as a hash, revocable and regenerable, with a public view that shows nothing personal
- Many-to-many self-relations (product links by type), with ordering, limits, no self-links, and a sensible fallback when nothing is set
- A points ledger: one service changes balances under a row lock, every change is recorded with the balance after it, and a unique key makes "earn once per order" hold even when two requests race
- Payment order and refunds across several tenders (points, then gift card, then the card) with proportional give-back and rounding rules
- Display currency vs charged currency: converting only at the formatter, keeping documents and totals in the base currency, and telling the shopper which amount they'll pay
- Comparison tables that stay accessible: a real `<table>` with row headers and a focusable scroll region on phones
- Splitting a phase across parallel agents against one written contract, with each side writing down its exact answer shapes for the others

## Phase 12 (backend): Taka as the store currency, and bKash / Nagad through SSLCommerz

- Money without a currency is a trap: why the store currency is a deployment setting, why each order records its own currency, and why switching means converting every stored price once (with a dry run, rounding rules, and a guard against running twice)
- Formatting money from one source of truth in three apps (store, admin, emails/PDFs), falling back safely until settings load
- A hosted payment page that returns with a cross-site form POST: why SameSite cookies aren't sent, answering with a 303 redirect, and never trusting the status the browser posts (validate with the provider on the server)
- Instant payment notifications (IPN) as the safety net for a missed return trip, made idempotent with a payment events table
- Fraud signals: holding a risky payment for staff review instead of invoicing it
- Expiring unpaid orders safely: ask the provider before cancelling
- Fonts in PDFs: a font only draws the characters it contains, so the taka sign needs a font that has it (Noto Sans Bengali as a fallback)

## Phase 13 (backend): The store in Bangla and English

- Internationalisation (i18n) with i18next and react-i18next: namespaced catalogs, stable keys, interpolation, plurals, loading a second language lazily as its own chunk
- Keeping two languages in step: tests that every key exists in both catalogs with the same variables, and that no hard-coded English is left on Bangla pages
- Where the language comes from: a cookie, the customer's account (which wins after sign-in), the store default; `<html lang>` and `lang="en"` on text that fell back to English, for screen readers
- Server side: a locale middleware reading `Accept-Language`, Laravel's `lang/` files for validation and the app's own messages, and caches that must vary by language
- Translatable content in the database: translation tables with per-field fallback to the base language, full-text search over the translations
- Formatting by locale with `Intl`, and when not to use it: Bangla digits, and keeping money in the same layout as emails and PDFs
- Emails and PDFs in the recipient's language, and the limits of PDF engines with complex scripts (Bangla conjuncts in dompdf)
- Never hard-code a number that belongs to a setting (the free-shipping "$50"): read it from the store and format it in the shopper's language

## Phase 14 (backend): Bangladesh delivery and cash on delivery

- Using open data responsibly: checking a dataset's licence, keeping its LICENSE and source next to it, and filling its gaps with your own clearly marked file
- Reference data in the database: idempotent seeders run from migrations, stable ids, and caches that must be versioned when the data changes
- Cascading selects (Division → District → Area) that stay accessible: disabled until the step before is chosen, loading and retry states, keyboard friendly
- Country-specific rules behind a switch: strict Bangladesh addresses and mobile numbers only when the store says so, so every other address keeps working
- Zones on top of an existing rules table (shipping rates) instead of a second pricing system
- Cash on delivery as a payment state machine: advance paid online, partly paid, cash collected (in full or short), invoiced at the end
- Operational workflows for staff: a phone-confirmation queue with a log, and a guarded override with a reason
- Files for other systems: PDFs for printing and CSV for couriers (UTF-8 BOM for Excel, formula-injection guard, local phone format)

## Home page: single banner or slider (2026-11-24)

- One stored content with a mode switch (`hero_mode`), so switching back never loses the other design
- A carousel built to the WAI-ARIA pattern: roledescription, "2 of 3" slide labels, Pause / Play, no autoplay with reduced motion, hidden slides made `inert`
- A safe fallback in the public API: slider mode with no active slide shows the banner instead of an empty slider
- "Replace everything" saves need the client to send every key back, or the server's defaults wipe data: the admin always sends slides and settings
- Data migrations that only fill empty fields whose English is still the demo text, so staff edits are never overwritten

## Phase 16: configurable products (2026-11-24)

- Building on an existing model (options and variants from phase 5) instead of a new one: types, swatches and image links are small additions
- Language-independent codes for URLs: names are translated, codes are not, so a shared link works in every language
- Magento's product page rules: nothing pre-selected, "From" prices, a message per missing option with focus moved there, no cart call until the choice is complete
- Accessible swatches: real radio inputs behind the colour circles, the value name as their accessible name, "sold out" in the name instead of colour alone
- Listing performance: eager loading the relations every card needs, with a test that the query count doesn't grow with the number of products

## Storefront redesign (2026-11-25)

- Design tokens pay off: changing the theme in one file recoloured the whole store before any component was touched
- Contrast is checked with numbers, not by eye: bright coral fails with white text (2.8:1), so it carries dark text or decoration only, and a deeper coral carries white text
- Honest marketing: no countdown without a real end date, no "10% off" promise the store doesn't keep, badges rounded the same way everywhere
- Renaming what staff see (Ink / Indigo / Coral / Violet) without changing stored keys keeps old content working
- A new element with a common name ("Close announcement") can make older tests ambiguous: tests scope to the dialog they mean

## Phase 17: marketplace-style storefront (2026-11-25)

- Borrowing a design's *style* from a commercial template (layout, kinds of sections) while writing every line, image and text ourselves: the template's files need a licence
- Honest data as a rule: "Best selling" from real orders with `units_sold` / `has_sales` so a list never pretends; coupons only while active; no invented "sold recently" or countdowns
- A proxy that whitelists fields can silently drop a new one (`has_sales`): test the whole path, not just each side
- Checking layouts at many widths (390 → 1440), not just phone and desktop: the tablet header overflowed
- Landmarks: a dialog opened from inside `<header>` must not contain its own `<header>`/`<footer>`
- React's development mode runs effects twice; count network requests on the production build before calling something slow

## Storefront restyle: follow the reference design (2026-11-25)

- Matching a reference look means matching its tokens first (colour, font, radius, shadow): most of the restyle came from one file
- A reference's colours aren't automatically accessible: its coral-red fails with white text, so a deeper red carries text and the bright one stays decorative
- Never open a file for writing before reading it in the same script: `open(p, 'w')` empties it first
- Compare screenshots side by side with the reference at the same widths, then list the intentional differences instead of leaving them implicit

## Phase 18: courier integration (2026-11-25)

- One driver interface (book, status, balance, normalise) and one class per courier: a courier's wire format is a one-file change when the real sandbox disagrees with the docs we had
- Couriers speak their own status words; the store keeps its own short list (booked → delivered, plus on hold / returned / cancelled) and keeps the raw word for staff
- Webhooks are idempotent and one-way: the same message twice adds nothing, and a late message never moves a finished parcel back
- Automatic changes only where they are safe (delivered → delivered and cash recorded); anything that needs a person (returned, partly delivered) becomes an alert, not an order change
- Booking locks the order row while the courier answers, so two clicks can't book twice; the order number is the courier's invoice id, so a retry after a timeout is refused as a duplicate
- External services are tested with stand-in servers and a second API whose environment points at them: real code paths, zero real calls

## Phase 19: welcome coupon (2026-11-27)

- A promotion is only honest if the page that promises it reads the same switch that grants it: the storefront shows "Get 10% off" from the API's `welcome_offer`, never from hard-coded text
- "One per email, ever" lives in its own table with a unique index, so it survives deleted coupons and accounts and decides races between two requests
- Rewards go only to confirmed addresses (verified account email, confirmed newsletter link), otherwise anyone could mint codes for made-up emails
- Personal codes are checked twice: in the cart with what is known, and again at checkout when the email is certain
- Side effects of a main action (sending a code after sign-up) never block that action: failures are reported, and the email goes after the database commit
- When work is cut off mid-way (a usage limit here), resuming the same builders keeps their context; check for empty files before carrying on

## Phase 20: SMS notifications for orders (2026-11-27)

- Hook notifications to the facts the app already records (a shipment created, a history row with "customer notified") instead of copying a send call next to every email: courier, bulk and manual shipping all text the customer through one listener
- A unique "dedupe key" per order and event makes sending idempotent even when two requests race
- Links in SMS get opened by phone apps and link previews: a GET must never change anything; the customer acts with a button (POST)
- Store only a hash of a link token, make it single-purpose and short-lived, and rate-limit the endpoint
- SMS length is part of the design: Bangla switches the whole text to Unicode (70 characters per part instead of 160), so the admin shows a live parts counter and English money is written "Tk" to stay in the cheaper encoding
- A dev "SMS inbox" (like the email test inbox) lets the browser suite read real messages without any provider

## Setting up on any computer from a fresh clone (2026-11-28)

- A project isn't really "in git" until a fresh clone runs: try it the way a newcomer would (a new folder, the computer's default tools), not on the machine that already works
- Secrets never go in git, even in a private repo (keys stay in its history for good); instead commit `.env.example` with empty names and a script that makes each computer's own `.env` with new random keys, without printing them
- Set-up scripts should be idempotent (safe to run again): each step checks whether it's already done, and existing settings files are never overwritten
- Don't depend on the system's defaults when they're too old: link the right versions in a project folder (`.tools/bin`) and put it first on `PATH`; after changing what a command points to in a running script, `hash -r` makes bash look again
- Ubuntu's AppArmor confines programs by their path: the system `mysqld` may only use the system's folders, so a private database copies the program; MySQL also limits the socket file path to 107 characters
- `npm ci` installs exactly what the lock file says and refuses when `package.json` and the lock disagree; that refusal is a useful early warning, so fix the lock file rather than switching to `npm install`
- Number formatting comes from the runtime's built-in rules (ICU), which change between versions: give `Intl.NumberFormat` both the minimum and the maximum number of decimals, or a newer browser may show `৳12.0K` where an older one showed `৳12K`
- Tests that time out under heavy CPU load (other apps running) are a load problem, not a code problem: rerun with fewer workers before changing anything
- A fresh clone also shows which settings lived only on the old computer: the browser suites passed there because its `.env` had relaxed request limits (SQA report, phase 5, S6), which no file in git recorded; the set-up script now writes them, and the example file explains why
- When failures move to a different place on every run, log the network: the admin's requests answered 429 "Too Many Requests", which looked like "no search results" and "the page never loaded"
- An interrupted test run leaves its test data behind (its clean-up never ran): check for leftovers before trusting the next run, and remove them the way the suite's own clean-up would
- An accessibility check that runs mid-fade measures half-transparent text: wait for running animations to finish before measuring contrast

## Phase 21: sales and cash reports (2026-11-28)

- Survey before you build: three read-only agents mapped the code first and found 12 places where the plan didn't match it (a helper that returns labels, not codes; an error field dropped twice on its way to the screen; a time zone sent in `meta`, not `data`), all fixed in the plan before any code was written
- Reports are only as honest as their definitions: "who has the cash" had to follow how the money really moves (a courier's rider collects it, even when staff type it in), a returned parcel is not money "still to collect", and a negative balance needs the right reason ("paid more than recorded" only when payments were recorded)
- Time zones: store whole UTC instants, filter with UTC start/end of the local day, and group by local day in code; "today" in Dhaka starts at 18:00 UTC the day before
- Agents can be cut off (here by an internet drop): they keep their context, so check the working tree for empty or half-written files, then tell them to resume from the files' real state
- A browser suite that shares a database with others checks changes ("+1 order") and rules that must always hold (the parts add up to the total), never absolute numbers

## Phase 22: product reviews with photos (2026-11-28)

- Private until approved: customer photos are stored where the web server can't reach them (Laravel's private disk), and the only way to fetch one checks that its review is approved and the photo isn't hidden. Product photos are different: the shop chose them, so they are public files
- Phone photos carry hidden data, often the exact GPS spot where they were taken (a customer's home). Every photo is cleaned twice: the browser redraws it on a canvas (smaller, no hidden data), and the server re-encodes it again, because a browser step can always be skipped by someone sending the file directly
- Never trust a file's name or type: the server reads the first bytes to decide what it is, and gives it a random name of its own
- Caching has a cost: product photos can be cached for a year because they never change, but a review photo that staff hide must disappear, so it is cached for 5 minutes only
- A test that fails can be the test's fault: here the Bangla check set the language cookie after signing in, but the store (by design, phase 13) lets the account's language win, so the test switched language the way a shopper does
- Agents can stop on a usage limit as well as an internet drop: their work is saved, and once the limit resets a short message lets each one carry on

## Phase 23: My reviews (2026-11-28)

- "Not found", not "forbidden": when someone asks for another customer's review or photo, the answer is 404, exactly as if it didn't exist. A 403 would confirm that the review exists, which is already a small leak
- Two addresses for one photo: the public one works only while the review is approved and the photo isn't hidden (and may be cached for 5 minutes); the author's own one works in every status but is never cached (`private, no-store`) and needs their session
- After deleting an item from a paged list, the server's pages shift up by one: reload the pages already shown, or "Show more" skips an item
- Translation texts can hold tags for links (`<page>See it in My reviews</page>`), but not names that are real HTML tags: `<link>` is an empty element, so the words fell outside the link
- A test that reads saved data the moment the screen changes can fail at random: the screen may update a moment before the data is written, so the test waits for the data itself
- "Random" test failures are worth chasing: two suites failed with the same symptom (an order never confirmed), and the API's error log had a "duplicate entry" at exactly those minutes. Two requests at the same moment both saw "no saved cart yet" and both tried to add one (a race condition). The fix: when the database says the row already exists, update it. The test makes the race happen on purpose, and it failed before the fix and passed after

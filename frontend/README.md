# BuyNest — Frontend

React storefront for BuyNest, built with Vite and plain JavaScript (ES6+).

## Tech stack (current)

| Tool | Purpose |
| --- | --- |
| React 19 | UI library (functional components and hooks) |
| Vite 8 | Dev server with hot module replacement, and production bundler |
| React Router 8 | Client-side routing (`BrowserRouter`, nested routes, URL search params) |
| Fetch API | All app HTTP requests, through `services/apiClient.js` |
| Axios | Learning comparison only (`src/learning/`, API playground at `/learn`) |
| react-icons | Icon components (Lucide set for UI, Font Awesome 6 for brand logos) |
| ESLint 10 | Code quality: core JS rules, Rules of Hooks, Fast Refresh safety |
| CSS3 | Design tokens (CSS custom properties) and one stylesheet per component |

Planned for later phases: TanStack Query, React Hook Form + Zod, Vitest + React Testing Library.

## Requirements

- Node.js 20.19+ or 22.12+ (developed on Node 24)
- npm 10+

## Installation

```bash
cd frontend
npm install
cp .env.example .env.local   # then adjust values if needed
npm run dev                  # http://localhost:5173
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server with hot module replacement |
| `npm run build` | Create an optimized production build in `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | Check all JS/JSX files with ESLint |
| `npm run lint:fix` | Auto-fix the lint problems that can be fixed safely |

## Environment variables

| Variable | Example | Used for |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `https://dummyjson.com` | Product API base URL. Required: the app throws a clear error at startup if it's missing. |

Only variables prefixed with `VITE_` reach browser code, and anything in them is public. Never store secrets there.

## Folder structure

```
frontend/
├── public/                 # Copied as-is to the build (favicon, static images)
├── src/
│   ├── assets/styles/      # Global CSS: tokens.css, base.css (reset), utilities.css
│   ├── components/
│   │   ├── common/         # Small shared pieces: Logo, SearchBar, SectionHeading, ScrollToTop
│   │   ├── layout/         # Page chrome: AnnouncementBar, Header, navigation, Footer
│   │   ├── home/           # Homepage sections: HeroBanner, PromoBanner, ProductSection…
│   │   ├── product/        # ProductCard, ProductGrid, ProductBadge, RatingStars, CategoryCard
│   │   ├── cart/           # CartDrawer, CartLineItem, CartSummary, CouponForm, FreeShippingProgress
│   │   ├── forms/          # Forms: Newsletter (auth and checkout forms later)
│   │   └── ui/             # Generic building blocks: Button, Modal, Loader, Toast…
│   ├── pages/              # One component per route (HomePage, NotFoundPage…)
│   ├── layouts/            # Shared page shells rendered around routes (MainLayout)
│   ├── routes/             # Route table (AppRoutes)
│   ├── hooks/              # Custom hooks: useFetch, useCatalogProducts, useCategories, useToast
│   ├── context/            # Context objects + providers (CartProvider; wishlist and auth next)
│   ├── reducers/           # Pure reducers (cartReducer)
│   ├── services/           # API layer: apiClient, product/category services, adapters/
│   ├── utils/              # Pure helpers: pricing, catalog filter/sort/paginate, formatters, cn
│   ├── constants/          # App-wide constants: routes, nav links, store settings
│   ├── data/               # Homepage content config + an offline product fixture for tests
│   ├── learning/           # Teaching examples: class components, Axios, HTTP methods playground
│   ├── App.jsx             # Root component
│   ├── main.jsx            # Entry point: mounts React into index.html
│   └── index.css           # Imports the global stylesheets
├── .env.example            # Documented environment variables
├── eslint.config.js        # ESLint flat config
├── index.html              # HTML shell; Vite injects the bundled JS
└── vite.config.js          # Vite configuration
```

Empty folders hold a `.gitkeep` file so Git tracks them until their phase begins.

## Routes

| Path | Page | Status |
| --- | --- | --- |
| `/` | HomePage | Done |
| `/learn` | Component lab (living style guide, class vs functional examples) | Done |
| `/products` (`?q=`, `?sort=`) | ProductListingPage: all products or search results, with filters, pagination, grid/list, quick view | Live API |
| `/categories/:categorySlug` | ProductListingPage for one category | Live API |
| `/deals` | ProductListingPage sorted by biggest discount | Live API |
| `/products/:productId` | ProductDetailsPage: gallery, pricing, stock, quantity, specs, reviews, related | Live API |
| `/cart` | CartPage: lines, quantities, coupon, shipping estimate, price/stock re-check | Done (localStorage) |
| `/checkout` | Checkout | Placeholder until Phase 10 |
| `/wishlist` | WishlistPage: saved items, move to cart, remove, availability re-check | Done (localStorage) |
| `/login`, `/register` | Sign in (demo account emilys / emilyspass), registration (simulated) | Guest-only |
| `/forgot-password` | Password reset request (simulated, no email sent) | Public |
| `/account` | Profile from `GET /auth/me` | Protected |
| `/account/orders` | Order history | Protected; placeholder until Phase 10 |
| `*` | NotFoundPage | Done |

## Components

| Component | Responsibility |
| --- | --- |
| `AnnouncementBar` | Promo messages above the header (one on mobile, all on desktop) |
| `Header` | Logo, search, account/wishlist/cart links, owns mobile-menu state |
| `Logo` | Brand mark linking home; `tone="light"` for dark backgrounds |
| `SearchBar` | Search with debounced live suggestions (ARIA combobox); navigates to `/products?q=…` |
| `MainNavigation` | Desktop nav with active-link highlighting (`NavLink`) |
| `MobileNavigation` | Drawer menu built from `Modal` + `SearchBar` |
| `HeroBanner` | Hero headline, CTAs, and product image |
| `CategoryCard` | Category tile linking to its category page |
| `ProductCard` | Grid or list layout: image, brand, category, title, rating, prices, availability, badges, add-to-cart, wishlist, quick view |
| `ProductGrid` | Responsive grid/list of `ProductCard`s with an empty state |
| `CatalogFilters` | Controlled price, rating, brand, and availability filters (sidebar and mobile drawer) |
| `ActiveFilters` | Removable chips for each active filter, plus Clear all |
| `SortSelect` / `ViewToggle` | Sort dropdown; grid/list toggle |
| `Pagination` | Accessible page numbers with gaps |
| `QuickViewModal` | Product summary in a modal, fetched by ID |
| `ProductGallery` | Main image with thumbnail buttons |
| `QuantitySelector` | Stepper limited to [min, max] |
| `ProductReviews` | Review cards (name, date, rating, comment) |
| `Breadcrumb` | Accessible breadcrumb trail |
| `CategoryNav` | Category links from the API |
| `ProductGridSkeleton` | Loading placeholders matching the grid |
| `ProductBadge` | Sale, stock, and info pills |
| `RatingStars` | 0–5 rating rendered as half-step stars, accessible label |
| `Newsletter` | Validated email sign-up (demo only, nothing is sent) |
| `Footer` | Link groups, contact details, social links, copyright |
| `Button` | Shared button/link styles: variants and sizes |
| `Loader` / `ErrorMessage` / `EmptyState` | Loading, error (with retry), and empty states |
| `Modal` | Accessible dialog built on native `<dialog>` (center or drawer) |
| `Toast` | Auto-dismissing status message |
| `WishlistButton` | Heart toggle connected to the wishlist context |
| `CartDrawer` | Slide-out mini cart (opens on add) |
| `CartLineItem` | Cart row: image, price, quantity selector, remove, notices |
| `CartSummary` / `CouponForm` | Totals, savings, shipping estimate, discount code |

## API layer

```
Component ──▶ custom hook (useFetch / useProductList) ──▶ service (productService)
                                                              │
                                     adapter (dummyJsonAdapter) ◀── apiClient (fetch) ──▶ DummyJSON
```

- **apiClient** builds URLs from `VITE_API_BASE_URL`, sets JSON headers, applies a 15-second timeout, turns HTTP and network failures into `ApiError` (message and status), and passes cancellations through.
- **Services** know the endpoints. **Adapters** convert raw API responses into BuyNest's own shapes; to switch to Laravel, write a new adapter and keep the components.
- **Hooks** track loading, error, retry, and cancellation (`AbortController`) for components.
- **Catalog filtering** is split: search and category on the server; price, rating, brand, stock, sorting, and pagination on the client, because DummyJSON has no parameters for them. See [docs/phases/phase-04-product-catalog.md](../docs/phases/phase-04-product-catalog.md).

### Endpoints in use

| Method | Endpoint | Used by |
| --- | --- | --- |
| GET | `/products?limit=0&select=` | Catalog and homepage (all products, card fields only) |
| GET | `/products/search?q=&limit=0` | Search scope of the catalog |
| GET | `/products/category/:slug?limit=0` | Category scope of the catalog |
| GET | `/products/categories` | Category nav and homepage tiles |
| GET | `/products/search?q=&limit=6&select=…` | Search suggestions (debounced) |
| POST | `/auth/login` | Sign in → access + refresh tokens |
| GET | `/auth/me` (Bearer token) | Session check and profile |
| POST | `/auth/refresh` | New tokens after a 401 |
| POST | `/users/add` | Registration (simulated; nothing is saved) |
| GET | `/products/:id` | Quick view and the product details page |
| GET | `/products/category/:slug?limit=5` | Related products |
| POST/PUT/PATCH/DELETE | `/products/add`, `/products/:id` | API playground only; DummyJSON simulates these and saves nothing |

DummyJSON quirks we handle: unknown categories return `200` with an empty list (we check against the category list), unknown `sortBy` values are silently ignored (we only send whitelisted sort options), and there is a rate limit of about 100 requests per time window.

## State management

| State | Where | Why |
| --- | --- | --- |
| Server data (products, categories) | `useFetch` hooks per component | Fetched, cancellable; caching arrives with TanStack Query in Phase 11 |
| Cart | `CartProvider` (Context + `usePersistentReducer`), `localStorage` key `buynest.cart.v1` | Needed across the whole app; rules live in one pure reducer |
| Wishlist | `WishlistProvider` (same pattern), key `buynest.wishlist.v1` | Shared by every product card, the header, and `/wishlist` |
| Signed-in customer | `AuthProvider`, key `buynest.session.v1` in localStorage ("keep me signed in") or sessionStorage | Demo token auth; production will use Sanctum HttpOnly cookies |
| URL state (search, filters, sort, page, view) | `useSearchParams` + `utils/catalogParams.js` | Back/forward, refresh, and shared links restore the same results |
| Local UI state (menu, drawers, gallery image) | `useState` in the component | Only one component cares |

The cart is a client-side convenience: prices, stock, coupons, shipping, and totals must be re-validated by the backend at checkout.

## Sample data vs real data

Product data is loaded live from DummyJSON. The homepage "Featured", "New arrivals", and "Best sellers" lists are hand-picked product IDs (`src/data/homeContent.js`), because DummyJSON has no such flags. They are not real sales or recency data.
`src/data/sampleProducts.js` is an offline snapshot of real records, kept for tests that must not depend on the live API.
The newsletter and add-to-cart actions are UI demos until the cart (Phase 6) and backend exist.

## Accessibility

- Semantic landmarks (`header`, `nav`, `main`, `footer`) and a skip link
- Visible `:focus-visible` outlines on every interactive element
- Labelled form controls, `role="alert"` errors, `role="status"` announcements
- Native `<dialog>` for focus trapping and Escape-to-close
- Decorative images use `alt=""`; product names come from the linked title
- Honors `prefers-reduced-motion`

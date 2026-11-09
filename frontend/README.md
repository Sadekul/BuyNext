# BuyNest — Frontend

> Your Modern Shopping Destination

A responsive React storefront: catalog with search and filters, product pages, cart, wishlist, sign-in, checkout, and order history. It runs against the public **DummyJSON** test API today and is ready to switch to the future **BuyNest Laravel API**.

## What's real and what's simulated

| Real (live API data) | Simulated (clearly labelled in the UI) |
| --- | --- |
| Products, categories, search, product details, reviews | Orders and payments: nothing is charged or shipped |
| Sign-in with DummyJSON demo accounts (`emilys` / `emilyspass`), token refresh | Registration (DummyJSON doesn't save new users) |
| Server price check before an order (`POST /carts/add`) | Password reset email (no API exists) |
| | Profile name edit (not saved by DummyJSON) |

Cart, wishlist, and demo orders live in the browser (`localStorage`). Each signed-in account has its own cart and wishlist; signing out shows an empty guest cart and wishlist, and guest items move into the account on sign-in. The backend must re-validate prices, stock, discounts, shipping, taxes, and totals before taking real orders.

## Tech stack

| Tool | Purpose |
| --- | --- |
| React 19 | UI (functional components, hooks) |
| Vite 8 | Dev server with HMR and production bundler |
| React Router 8 | Client-side routing, nested and protected routes, URL search params |
| TanStack Query 5 | Server-state cache: queries, mutations, retries, background refetching |
| React Hook Form + Zod | Checkout form state and schema validation |
| Fetch API | All HTTP requests through `src/services/apiClient.js` |
| react-icons | Icons (Lucide set; Font Awesome 6 for brand logos) |
| CSS3 | Design tokens (custom properties) and one stylesheet per component |
| ESLint 10 | Core JS rules, Rules of Hooks, Fast Refresh safety |
| Vitest + React Testing Library | Unit, component, and integration tests |
| Axios | Development-only learning comparison (`/learn`); not in production builds |

## Requirements
- Node.js 20.19+ or 22.12+ (`.nvmrc`: 24)
- npm 10+

## Getting started
```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev            # http://localhost:5173
```

## Scripts
| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot module replacement |
| `npm run build` | Production build in `dist/` |
| `npm run preview` | Serve the production build locally (http://localhost:4173) |
| `npm run lint` / `lint:fix` | ESLint check / auto-fix |
| `npm test` | Run all tests once (offline) |
| `npm run test:watch` | Re-run tests on save |

## Environment variables
| Variable | Default / example | Purpose |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `https://dummyjson.com` | API base URL. **Required**: the app stops with a clear error if it's missing |
| `VITE_API_PROVIDER` | `dummyjson` | Backend adapter: `dummyjson` or `laravel` |
| `VITE_SHOW_LEARNING_LAB` | `false` | Include the `/learn` component lab in production builds (always on in dev) |

Only `VITE_` variables reach the browser, and everything in them is **public**. Never put secrets, admin tokens, or private API keys here.

## Folder structure
```
frontend/
├── public/                 # Copied as-is: favicon, _redirects/_headers (Netlify)
├── src/
│   ├── assets/styles/      # tokens.css, base.css (reset), utilities.css
│   ├── components/
│   │   ├── common/         # Logo, SearchBar, Breadcrumb, Pagination, ErrorBoundary, ScrollToTop…
│   │   ├── layout/         # AnnouncementBar, Header, Main/MobileNavigation, Footer, OfflineBanner
│   │   ├── home/           # HeroBanner, FeaturedCategories, ProductSection, PromoBanner, BenefitsSection
│   │   ├── product/        # ProductCard/Grid, filters, gallery, quick view, reviews, wishlist button…
│   │   ├── cart/           # CartDrawer, CartLineItem, CartSummary, CouponForm, FreeShippingProgress
│   │   ├── checkout/       # AddressFields
│   │   ├── orders/         # OrderItems, OrderTotals, OrderStatus, OrderDetailsView
│   │   ├── forms/          # FormField/SelectField/CheckboxField, ChoiceCards, Newsletter, EditNameForm
│   │   └── ui/             # Button, Modal, Loader, ErrorMessage, EmptyState, Toast
│   ├── pages/              # One component per route
│   ├── layouts/            # MainLayout (header/footer/boundary/suspense), AccountLayout
│   ├── routes/             # AppRoutes (lazy routes), ProtectedRoute, GuestOnlyRoute
│   ├── context/            # Auth, Cart, Wishlist, Orders providers + context objects
│   ├── reducers/           # cartReducer, wishlistReducer, ordersReducer (pure)
│   ├── hooks/              # useCart, useWishlist, useAuth, useOrders, usePersistentReducer, useDebouncedValue…
│   ├── services/           # apiClient, product/category/auth/order services
│   │   ├── providers/      # Endpoints per backend (dummyjson, laravel)
│   │   └── adapters/       # API responses → BuyNest shapes
│   ├── queries/            # TanStack Query keys + queryOptions
│   ├── schemas/            # Zod schemas (checkout)
│   ├── lib/                # QueryClient setup
│   ├── utils/              # Pricing, cart totals, catalog filters, URL params, validation, formatters…
│   ├── constants/          # Routes, store rules (shipping, coupons), site settings
│   ├── data/               # Homepage content config; offline product snapshot for tests
│   ├── learning/           # Teaching examples (class components, Axios, HTTP playground)
│   ├── test/               # Test setup, renderWithProviders, mockFetch, fixtures
│   ├── App.jsx             # Providers + routes
│   └── main.jsx            # Entry point (BrowserRouter)
├── vercel.json             # Vercel: SPA rewrites + headers
├── eslint.config.js
└── vite.config.js          # Vite + Vitest config
```

## Routes
| Path | Page | Access |
| --- | --- | --- |
| `/` | Homepage | Public |
| `/products?q=&sort=&brand=&minPrice=&maxPrice=&rating=&available=&page=&view=` | Catalog (all products or search) | Public |
| `/categories/:slug`, `/deals` | Category, biggest discounts | Public |
| `/products/:id` | Product details | Public |
| `/cart`, `/wishlist` | Cart, wishlist | Public |
| `/login`, `/register` | Sign in, registration (simulated) | Guests only |
| `/forgot-password` | Password reset request (simulated) | Public |
| `/account`, `/account/orders`, `/account/orders/:id` | Profile, order history, order details | Signed in |
| `/checkout`, `/order-confirmation/:id` | Checkout (simulated order), confirmation | Signed in |
| `/learn` | Component lab (development only) | — |

## Architecture
```
Component ─▶ hook (useQuery / useCart / useAuth…)
                │
                ├─ server state: queries/ ─▶ services/ ─▶ providers/ + adapters/ ─▶ apiClient ─▶ API
                └─ client state: context/ + reducers/ ─▶ localStorage (usePersistentReducer)
```

| State | Where | Why |
| --- | --- | --- |
| Server data (products, categories, profile) | TanStack Query | Cached, deduplicated, retried, refreshed in the background |
| Cart, wishlist, demo orders | Context + `useReducer`, saved in `localStorage` (`buynest.*.v1`, one copy per account plus a guest copy), synced across tabs | Needed across the app; rules in pure reducers |
| Signed-in customer | `AuthProvider` (Web Storage, demo only) | Production: Sanctum HttpOnly cookies |
| Search, filters, sort, page, view | URL search params | Back/refresh/share restore results |
| Local UI (menus, drawers, gallery) | `useState` | Only one component cares |

### API endpoints in use (DummyJSON)
| Method | Endpoint | Used for |
| --- | --- | --- |
| GET | `/products?limit=0&select=…` | Catalog scope, homepage, cart/wishlist price checks |
| GET | `/products/search?q=` | Search scope and suggestions |
| GET | `/products/category/:slug` | Category scope, related products |
| GET | `/products/:id` | Product details, quick view |
| GET | `/products/categories` | Category navigation and tiles |
| POST | `/users/add` | Registration (simulated) |
| POST | `/carts/add` | Server price check before a (simulated) order |

Sign-in goes through BuyNest's own service at `/api/auth/*` ([server/authBff.js](server/authBff.js)): `POST login`, `GET me`, `POST refresh`, `PUT profile` (simulated), `POST logout`. It calls DummyJSON's `/auth/*` endpoints and keeps the tokens in HttpOnly, Secure, SameSite=Strict cookies, so no token ever reaches page JavaScript or browser storage. It runs inside `npm run dev` / `npm run preview`, and as a Vercel function (`api/auth/[action].js`) or Netlify function (`netlify/functions/auth.mjs`) when deployed. "Keep me signed in" makes the session last 7 days; otherwise it ends when the browser closes, and signing out (or the session ending) also deletes the account's saved cart, wishlist, and demo orders from the device.

Switching to Laravel: `VITE_API_PROVIDER=laravel` (contract: [docs/backend/API_CONTRACT.md](../docs/backend/API_CONTRACT.md)).

## Quality
- **Tests:** `npm test` runs 133 tests (reducers, utilities, schema, API client, adapter, components, page flows) with the network mocked.
- **Accessibility:** semantic landmarks, skip link, visible focus, labelled controls with linked errors, ARIA combobox search, native `<dialog>` modals, reduced-motion support. axe-core reports **no violations** on the main pages of the production build.
- **Performance:** route-level code splitting (checkout libraries and account pages load on demand), `React.memo` product cards, lazy images, cached server data. Initial JavaScript ≈ 124 KB gzipped.

## Deployment
See [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md): build settings, environment variables, SPA fallback (`vercel.json` or `public/_redirects`), caching, and a release checklist.

## Learning material
- Per-phase lessons: [docs/phases/](../docs/phases/)
- Concepts by phase: [docs/LEARNING_LOG.md](../docs/LEARNING_LOG.md)
- Backend plan: [docs/backend/](../docs/backend/)

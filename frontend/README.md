# BuyNest — Frontend

React storefront for BuyNest, built with Vite and plain JavaScript (ES6+).

## Tech stack (current)

| Tool | Purpose |
| --- | --- |
| React 19 | UI library (functional components and hooks) |
| Vite 8 | Dev server with hot module replacement, and production bundler |
| React Router 8 | Client-side routing (`BrowserRouter`, nested routes) |
| react-icons | Icon components (Lucide set for UI, Font Awesome 6 for brand logos) |
| ESLint 10 | Code quality: core JS rules, Rules of Hooks, Fast Refresh safety |
| CSS3 | Design tokens (CSS custom properties) and one stylesheet per component |

Planned for later phases: Axios, TanStack Query, React Hook Form + Zod, Vitest + React Testing Library.

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
| `VITE_API_BASE_URL` | `https://dummyjson.com` | Product API base URL (from Phase 3) |

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
│   │   ├── cart/           # Cart UI (Phase 6)
│   │   ├── forms/          # Forms: Newsletter (auth and checkout forms later)
│   │   └── ui/             # Generic building blocks: Button, Modal, Loader, Toast…
│   ├── pages/              # One component per route (HomePage, NotFoundPage…)
│   ├── layouts/            # Shared page shells rendered around routes (MainLayout)
│   ├── routes/             # Route table (AppRoutes)
│   ├── hooks/              # Custom hooks (from Phase 3)
│   ├── context/            # React Context providers: cart, wishlist, auth (Phases 6–9)
│   ├── reducers/           # useReducer logic, e.g. the cart reducer (Phase 6)
│   ├── services/           # API layer: all HTTP requests live here (Phase 3)
│   ├── utils/              # Pure helpers: formatPrice, cn (class names)
│   ├── constants/          # App-wide constants: routes, nav links, store settings
│   ├── data/               # Clearly labeled sample data used until the API is connected
│   ├── learning/           # Teaching examples (class vs functional components)
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
| `/products`, `/categories/:slug`, `/deals` | Catalog | Placeholder until Phase 4 |
| `/products/:productId` | Product details | Placeholder until Phase 5 |
| `/cart` | Cart | Placeholder until Phase 6 |
| `/wishlist` | Wishlist | Placeholder until Phase 7 |
| `/account` | Account | Placeholder until Phase 9 |
| `*` | NotFoundPage | Done |

## Components

| Component | Responsibility |
| --- | --- |
| `AnnouncementBar` | Promo messages above the header (one on mobile, all on desktop) |
| `Header` | Logo, search, account/wishlist/cart links, owns mobile-menu state |
| `Logo` | Brand mark linking home; `tone="light"` for dark backgrounds |
| `SearchBar` | Controlled search input; navigates to `/products?q=…` |
| `MainNavigation` | Desktop nav with active-link highlighting (`NavLink`) |
| `MobileNavigation` | Drawer menu built from `Modal` + `SearchBar` |
| `HeroBanner` | Hero headline, CTAs, and product image |
| `CategoryCard` | Category tile linking to its category page |
| `ProductCard` | Product image, brand, title, rating, prices, badges, add-to-cart |
| `ProductGrid` | Responsive list of `ProductCard`s with an empty state |
| `ProductBadge` | Sale, stock, and info pills |
| `RatingStars` | 0–5 rating rendered as half-step stars, accessible label |
| `Newsletter` | Validated email sign-up (demo only, nothing is sent) |
| `Footer` | Link groups, contact details, social links, copyright |
| `Button` | Shared button/link styles: variants and sizes |
| `Loader` / `ErrorMessage` / `EmptyState` | Loading, error (with retry), and empty states |
| `Modal` | Accessible dialog built on native `<dialog>` (center or drawer) |
| `Toast` | Auto-dismissing status message |

## Sample data vs real data

`src/data/` holds a snapshot of real DummyJSON records. Field names and values are unchanged, so components already match the live API shape.
The homepage "Featured", "New arrivals", and "Best sellers" lists are hand-picked product IDs, because DummyJSON has no such flags. They are not real sales or recency data.
The newsletter and add-to-cart actions are UI demos until the cart (Phase 6) and backend exist.

## Accessibility

- Semantic landmarks (`header`, `nav`, `main`, `footer`) and a skip link
- Visible `:focus-visible` outlines on every interactive element
- Labelled form controls, `role="alert"` errors, `role="status"` announcements
- Native `<dialog>` for focus trapping and Escape-to-close
- Decorative images use `alt=""`; product names come from the linked title
- Honors `prefers-reduced-motion`

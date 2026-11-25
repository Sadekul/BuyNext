# BuyNest

> Your Modern Shopping Destination

BuyNest is a modern e-commerce web application, built step by step as a professional React learning project.

## Repository layout

```
buynest/
├── frontend/   # React + Vite storefront (phases 1–14 complete) and its server functions (sign-in, admin API)
├── admin/      # React admin dashboard for shop staff, served at /admin
├── backend/    # Laravel 13 API + MySQL: customer and admin accounts (phase 1 of the backend)
├── e2e/        # Real-browser checks for the storefront, sign-up, and the admin dashboard
├── dev.sh      # Starts MySQL, the API, the store, and the admin in one terminal
└── docs/       # Phase lessons, learning log, backend contract, deployment guide, SQA report
```

## How the pieces connect

```
Store pages ─┐
             ├─▶ sign-in service (same address, HttpOnly cookies) ──▶ Laravel API ──▶ MySQL
Admin pages ─┘   frontend/server                                       backend/
```

- **Accounts are real** (Laravel + MySQL): customers sign up with name, email, phone, and password, confirm their email with a 6-digit code, and can reset their password by code. Shop staff have **separate admin accounts**; a customer can never sign in to the admin. How and why: [docs/backend/ACCOUNTS.md](docs/backend/ACCOUNTS.md).
- **The catalog and orders are real** (phase 2): 194 products imported into MySQL, the server prices every cart, orders reserve stock and send a confirmation email, **guests can check out** and track their order, and admins ship, deliver, mark paid, or cancel orders (cancelling returns the stock). Agreement: [docs/backend/PHASE2_CONTRACT.md](docs/backend/PHASE2_CONTRACT.md).
- Set `VITE_API_PROVIDER=laravel` and `VITE_ACCOUNTS_BACKEND=laravel`; with `dummyjson` the original DummyJSON demo still works.
- All API calls go through `frontend/src/services/` and `frontend/server/`. See [docs/backend/](docs/backend/).

## Getting started

First time: set up the API ([backend/README.md](backend/README.md#run-it)), then:

```bash
cd admin && npm install && cd ..
cd frontend && npm install && cp .env.example .env.local && cd ..
# in frontend/.env.local: VITE_API_PROVIDER=laravel, VITE_ACCOUNTS_BACKEND=laravel, BUYNEST_BFF_KEY (= BFF_SHARED_KEY in backend/.env)
./dev.sh           # MySQL + API + store + admin
```

| What | Address |
| --- | --- |
| Store | http://localhost:5173 |
| Admin dashboard | http://localhost:5173/admin/ |
| Track an order (guests) | http://localhost:5173/track-order |
| Content pages | http://localhost:5173/pages/about (also shipping-and-returns, privacy, terms, contact) |
| Test inbox (codes, order emails) | http://127.0.0.1:8000/dev/mailbox |

Local demo accounts (created by `php artisan db:seed`):

| Who | Sign in at | Email / password |
| --- | --- | --- |
| Customer | http://localhost:5173/login | **customer@buynest.test / CustomerPass2026** |
| Shop admin | http://localhost:5173/admin/ | **admin@buynest.test / AdminPass2026** |

Or create your own customer at http://localhost:5173/register and read the code in the test inbox.

Tests: `php artisan test` in backend/ (39), `npm test` in frontend/ (168) and admin/ (12), and the browser suites in e2e/.
Details: [frontend/README.md](frontend/README.md) · [admin/README.md](admin/README.md) · [backend/README.md](backend/README.md) · Deployment: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) · Browser checks: [e2e/README.md](e2e/README.md).

## Progress

| Phase | Topic | Status |
| --- | --- | --- |
| 1 | Environment and project setup | Done |
| 2 | Components and frontend template | Done |
| 3 | External API integration | Done |
| 4 | Product listing and catalog | Done |
| 5 | Product details page | Done |
| 6 | Shopping cart | Done |
| 7 | Wishlist | Done |
| 8 | Search, filtering, and sorting | Done |
| 9 | User registration and authentication | Done |
| 10 | Checkout and order management | Done |
| 11 | Advanced React | Done |
| 12 | Admin backend integration (frontend side) | Done |
| 13 | Testing and debugging | Done |
| 14 | Deployment | Done (push and hosting pending your approval) |
| — | SQA & security audit, account separation, secure-cookie sign-in | Done, see [docs/SQA_REPORT.md](docs/SQA_REPORT.md) |
| — | Admin dashboard | Done: overview, products (add/edit/delete, simulated), orders, customers; see [admin/README.md](admin/README.md) |
| B1 | Backend phase 1: accounts (Laravel + MySQL) | Done: sign-up with email code, sign-in, password reset, separate admin accounts, block customers; see [docs/backend/ACCOUNTS.md](docs/backend/ACCOUNTS.md) |
| B2 | Backend phase 2: catalog, real orders, customers' order history | Done: products in MySQL, server pricing, guest checkout, order tracking, order emails, admin order handling; see [docs/backend/PHASE2_CONTRACT.md](docs/backend/PHASE2_CONTRACT.md) |
| B3 | Backend phase 3: invoices, shipments, refunds, coupons | Done: invoices, shipments with carrier tracking links, partial and full refunds (credit memos) with restock, printable invoices, coupons managed in the admin; see [docs/backend/PHASE3_CONTRACT.md](docs/backend/PHASE3_CONTRACT.md) |
| B4 | Backend phase 4: admin roles and permissions, content pages, reports, settings | Done: roles (Owner, Sales staff, Catalog manager, Marketing, Viewer) enforced on every admin route, admin users, audit log, content pages and home page editor (HTML cleaned on the server), sales reports with CSV, store settings (shipping, tax, countries, payment methods, guest checkout); see [docs/backend/PHASE4_CONTRACT.md](docs/backend/PHASE4_CONTRACT.md) |
| B5 | Backend phase 5: Magento-style catalog | Done: category tree, product photo uploads, product options and variants (own SKU, price, stock), bulk actions on products, CSV import and export, customer reviews with approval; see [docs/backend/PHASE5_CONTRACT.md](docs/backend/PHASE5_CONTRACT.md) |
| B6 | Backend phase 6: customers and sales | Done: address book, customer groups with group pricing, full customer page (edit, addresses, notes, delete), admin-created phone orders, shipments list and packing slips, returns with refunds, order bulk actions and CSV export; see [docs/backend/PHASE6_CONTRACT.md](docs/backend/PHASE6_CONTRACT.md) |
| B7 | Backend phase 7: marketing and system | Done: catalog price rules, cart rules with conditions (automatic, groups, categories, buy X get Y, free shipping), newsletter with double opt-in and campaigns, editable email templates, SEO tags, sitemap, robots.txt, URL redirects, search terms, saved carts across devices, abandoned carts, Magento-style dashboard, notifications bell, saved grid views; see [docs/backend/PHASE7_CONTRACT.md](docs/backend/PHASE7_CONTRACT.md) |
| B8 | Phase 8: card payments, real email, hosting | Done (needs your accounts): Stripe Checkout with signed webhooks, automatic invoices, Pay now, expired payments cancel and restock, refunds back to the card; `buynest:mail-test` and the Brevo/Mailgun guide ([docs/EMAIL.md](docs/EMAIL.md)); Docker image and Railway guide ([docs/DEPLOY_RAILWAY.md](docs/DEPLOY_RAILWAY.md)); the API can be locked to the store only; see [docs/backend/PHASE8_CONTRACT.md](docs/backend/PHASE8_CONTRACT.md) |
| B9 | Phase 9: launch readiness and self-service | Done: two-step sign-in for admins (authenticator app, recovery codes, can be required for everyone), resized product photos with `srcset`, error alerts (Sentry, off until a DSN is set) and daily database backups with a Backups page, customers change their email, cancel unpaid orders, download their data, delete their account, and ask for back-in-stock emails; see [docs/backend/PHASE9_CONTRACT.md](docs/backend/PHASE9_CONTRACT.md) |
| B10 | Phase 10: search, PDFs, PayPal, shipping rates, gift cards, analytics | Done: typo-tolerant ranked search ("Showing results for…"), invoice and credit memo PDFs for admins and customers, PayPal checkout next to Stripe, shipping table rates by country, weight and order total, gift cards (bought in the store, applied at checkout, refunded to the card first), and Google Analytics 4 that only loads after the visitor accepts cookies; see [docs/backend/PHASE10_CONTRACT.md](docs/backend/PHASE10_CONTRACT.md) |
| B11 | Phase 11: wishlists, comparison, linked products, reward points, display currencies | Done: the wishlist is saved to the customer's account and can be shared by link, products can be compared side by side (up to 4, with specifications), admins choose related products, up-sells and cross-sells (and can duplicate a product), reward points are earned on paid orders and spent at checkout (off until turned on), shoppers can see prices in another currency such as BDT while paying in USD, and recently viewed products are shown; see [docs/backend/PHASE11_CONTRACT.md](docs/backend/PHASE11_CONTRACT.md) |
| B12 | Phase 12: taka (BDT) and bKash / Nagad through SSLCommerz | Done: the store currency is one setting (`BUYNEST_CURRENCY`, USD by default) and each order keeps its own currency; a one-time command converts stored prices to taka ([docs/CURRENCY.md](docs/CURRENCY.md)); SSLCommerz checkout for bKash, Nagad, Rocket and cards, with every payment validated on the server, risky payments held for review, expiry that checks before cancelling, Pay now, payment links, refunds and "Check payment"; PayPal is switched off in taka; see [docs/backend/PHASE12_CONTRACT.md](docs/backend/PHASE12_CONTRACT.md) |
| B13 | Phase 13: the store in Bangla (বাংলা) and English | Done: a language switch remembered on the device and in the customer's account, every shopper-facing page, message and email in Bangla with optional Bangla digits (৳১,২৫০.০০), Bangla product, category and page content entered in the admin (with English as the fallback), Bangla validation messages from the API, emails and invoice PDFs in the customer's language; the admin stays in English; see [docs/backend/PHASE13_CONTRACT.md](docs/backend/PHASE13_CONTRACT.md) and [docs/I18N.md](docs/I18N.md) |
| B14 | Phase 14: Bangladesh delivery and cash on delivery | Done: Bangladesh addresses by Division → District → Upazila/Thana (English and Bangla, from an open MIT dataset plus every Dhaka city thana), Bangladeshi mobile numbers, delivery zones (Inside Dhaka, Dhaka suburbs, Outside Dhaka) with charges and delivery times, cash on delivery with a limit, fee, zones and an optional delivery charge paid first through SSLCommerz, phone confirmation (Sales → To confirm), cash collected on delivery, packing slips and a courier CSV; all off until the store's default country is Bangladesh; see [docs/backend/PHASE14_CONTRACT.md](docs/backend/PHASE14_CONTRACT.md) and [docs/BANGLADESH.md](docs/BANGLADESH.md) |
| B15 | Home page: single banner or slider, and Bangla demo content | Done: in Content → Home page, staff choose the single banner or a slider of up to 8 slides (title, text, image, two buttons, colour, Bangla texts, active, order), with autoplay and seconds per slide; the store's slider is accessible (labels, Previous / Next, dots, Pause / Play, keyboard, swipe, no autoplay with reduced motion) in English and Bangla; Bangla drafts for the demo home texts and the 24 category names (only empty fields, never staff texts); see [docs/backend/HOME_SLIDER_CONTRACT.md](docs/backend/HOME_SLIDER_CONTRACT.md) |
| B16 | Phase 16: configurable products (Magento-style product page) | Done: options shown as colour swatches or text buttons (Size, Storage, RAM), photos per colour, nothing pre-selected with "From" prices, "Please select Size.", price / stock / SKU / photo following the choice, shareable links (`?color=blue&size=m`, the same in Bangla), colour dots and "Choose options" on cards, the admin's option type, colour picker and "Shown for" per image; six demo products made configurable (shirts, trainers, iPhone, Galaxy, Dell XPS); see [docs/backend/PHASE16_CONTRACT.md](docs/backend/PHASE16_CONTRACT.md) |
| B17 | Storefront redesign: indigo + coral, bold and colourful | Done: new theme (indigo, coral, ink; contrast-checked), gradient announcement bar, new header and category menu with icons, product cards (photo tiles, hover zoom and second photo, sale / New / Low stock badges, quick add), restyled product page, cart, checkout, account and footer; home page with category photo tiles, Today's deals (no fake countdowns), promo grid, New arrivals and Featured carousels, benefit tiles, brand chips and a newsletter block; English and Bangla, phones and accessibility kept; see [docs/STOREFRONT_REDESIGN.md](docs/STOREFRONT_REDESIGN.md) |

The concepts covered in each phase are listed in [docs/LEARNING_LOG.md](docs/LEARNING_LOG.md). Detailed lessons per phase are in [docs/phases/](docs/phases/).
# BuyNext

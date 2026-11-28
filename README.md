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
├── setup.sh    # One-time set-up on a new computer (packages, settings files, private MySQL, demo data)
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

### On a new computer (once)

Install these first:

| Program | Version | Ubuntu example |
| --- | --- | --- |
| PHP with mbstring, xml, curl, mysql, sqlite3, bcmath, intl, zip, gd | 8.3 or newer | `sudo apt install php8.3-cli php8.3-{mbstring,xml,curl,mysql,sqlite3,bcmath,intl,zip,gd}` |
| Composer | 2 | [getcomposer.org/download](https://getcomposer.org/download/) |
| MySQL server | 8 | `sudo apt install mysql-server` (it doesn't need to be running) |
| Node | 22.12 or newer | [nvm](https://github.com/nvm-sh/nvm) or `n`; the script installs it with `n` when `n` is there |
| Google Chrome | any recent | only for the browser test suites in `e2e/` |

Then:

```bash
git clone git@github.com:Sadekul/BuyNext.git BuyNest
cd BuyNest
./setup.sh         # once: packages, settings files, database, demo data (a few minutes)
./dev.sh           # every day: MySQL + API + store + admin (Ctrl+C stops it)
```

What [setup.sh](setup.sh) does, and why:

- **Uses a new enough PHP and Node** even when the computer's default ones are older: it links them in `.tools/bin` (not committed), and `dev.sh` and `demo.sh` use that folder first.
- **Makes its own private MySQL** in `.tools/mysql` on port 3307, so you don't need `sudo` or to touch a MySQL you already have. It copies the MySQL program there because Ubuntu's AppArmor only lets the system copy use the system's folders. To use your own MySQL instead, create a database and user and run `DB_HOST=… DB_PORT=… DB_DATABASE=… DB_USERNAME=… DB_PASSWORD=… ./setup.sh`.
- **Creates `backend/.env` and `frontend/.env.local`** from the `.env.example` files with new random keys (never printed). These hold secrets, so they are never committed; each computer has its own. Payments, couriers and SMS stay off until you add your own keys. The new `backend/.env` also **relaxes the request limits for development** (sign-ins, orders, reviews and API requests a minute), because the browser suites make far more requests than a real visitor; a live store keeps the stricter values from `.env.example`. A `backend/.env` made before 2026-11-28 may still have the strict ones: set `BUYNEST_AUTH_PER_MINUTE=300`, `BUYNEST_AUTH_PER_EMAIL_PER_MINUTE=100`, `BUYNEST_ORDERS_PER_MINUTE=100`, `BUYNEST_REVIEWS_PER_HOUR=100` and `BUYNEST_API_PER_MINUTE=2000` in it, then restart `./dev.sh` (the running API reads `backend/.env` only when it starts).
- **Creates the tables and demo data**: the demo accounts below, and the catalog downloaded once from DummyJSON.
- **Is safe to run again**: it skips everything that's already done and never overwrites your settings files.

For `php artisan`, `npm` and the browser suites in your own terminal, use the same PHP and Node: `export PATH="$PWD/.tools/bin:$PATH"` (from the repository folder). Clone into a short path such as `~/BuyNest`: MySQL's socket file path has a 107-character limit.

A fresh clone gets the standard demo store (prices in US dollars, Bangladesh delivery off), because the browser test suites expect it. Your own store's settings, orders and uploaded photos live in your database and `backend/storage`, not in git; switch to taka and Bangladesh as described in [docs/CURRENCY.md](docs/CURRENCY.md) and [docs/BANGLADESH.md](docs/BANGLADESH.md).

### Addresses

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

Tests: `php artisan test` in backend/ (682), `npx vitest run` in frontend/ (1,123) and admin/ (287), and the browser suites in e2e/ (`node e2e/run-all.mjs` with `./dev.sh` running).
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
| B18 | Phase 17: marketplace-style storefront (Fastkart-like layout, original design) | Done: top bar with the admin's promo message and a real coupon (Copy), "Deliver to" for Bangladesh stores (Division → District → Area with zone, charges, days and cash on delivery; remembered and pre-filling checkout), "All categories" mega menu, search in a category, sticky compact header, phone bottom tab bar, footer payment badges; home with a hero row and side promos, category icons, "Top products" tabs (Best selling from real sales only, Trending, New, On sale), compact product lists, coupon banner; API: `sort=best_selling` with units sold, delivery estimate, admin "Top promo strip"; see [docs/backend/PHASE17_CONTRACT.md](docs/backend/PHASE17_CONTRACT.md) |
| B19 | Storefront restyle: follow the reference design | Done: steel blue `#417394` with coral-red accents, flat light style, Public Sans, grey photo tiles, borderless centred product cards, light hero with side promos, grey category tiles with line icons, dark newsletter band, charcoal footer with store information; our own code, icons, images and texts (only colours and the free font matched); every feature, Bangla, phones and accessibility kept; see [docs/STOREFRONT_FASTKART_STYLE.md](docs/STOREFRONT_FASTKART_STYLE.md) |
| B20 | Phase 18: courier integration (Steadfast and Pathao) | Done: Settings → Couriers (set-up status, sandbox / live, webhook URLs, Steadfast balance, booking defaults); "Book courier" on the order page (cash to collect, weight, note, Pathao city / zone / area pre-matched from the address) and bulk "Book with Steadfast" from the orders grid; parcel card with consignment, tracking code, status, fee, collected cash, "Refresh status" and history; courier webhooks and a 30-minute status check: delivered marks the order delivered and, for cash on delivery, records the cash and marks it paid; returned / cancelled / partly delivered / on hold alert staff; customers see a delivery tracker in English and Bangla; RedX, Paperfly and Sundarban as manual carriers; nothing calls a real courier until credentials are set, and each courier must be checked with sandbox credentials before going live; see [docs/backend/PHASE18_CONTRACT.md](docs/backend/PHASE18_CONTRACT.md) and [docs/BANGLADESH.md](docs/BANGLADESH.md) |
| B21 | Phase 19: welcome coupon | Done (off until switched on): Marketing → Welcome coupon (earned on account sign-up and/or newsletter confirmation; percentage or fixed amount, optional minimum, days valid, first order only; live preview; issued / used / active / expired figures and the list of codes sent); each customer gets a personal one-time code by email in English or Bangla, shown on their account with Copy; one code per email address ever, only to confirmed addresses, only for that email; the newsletter and sign-up pages promise the offer only while it is on; welcome codes have their own tab on the Coupons page; "First order only" also available on staff coupons; see [docs/backend/PHASE19_CONTRACT.md](docs/backend/PHASE19_CONTRACT.md) |
| B22 | Phase 20: SMS notifications for orders | Done (off until switched on): Settings → SMS (provider: test mode, SSL Wireless or BulkSMSBD; which texts to send; editable English and Bangla texts with a live SMS-parts counter; send a test SMS; sent / failed figures), SMS log with search, filters and Retry, and an SMS panel on each order; texts for order placed, confirmed, shipped (courier and tracking link), delivered and cancelled, following the same "notify the customer" choice as emails; cash on delivery orders that need confirmation get a one-tap link (`/c/…`) where the customer confirms or cancels, which updates the To confirm list; checkout says "We'll text order updates to this number" only while it is on; no real SMS until a provider account is added, and each provider must be checked with a test SMS before going live; see [docs/backend/PHASE20_CONTRACT.md](docs/backend/PHASE20_CONTRACT.md) and [docs/BANGLADESH.md](docs/BANGLADESH.md) |
| B23 | Private online demo | Ready: `./demo.sh` (with `./dev.sh` running) shares the production build through a free Cloudflare quick tunnel at a temporary `https://….trycloudflare.com` address, behind a demo password on every page (the demo accounts' passwords are public in this repository), only tunnel host names accepted, not indexed by search engines; Ctrl+C stops it; needs `cloudflared` installed once; see [docs/DEMO.md](docs/DEMO.md) |
| B24 | Set up on any computer from a fresh clone | Done: `./setup.sh` checks PHP 8.3+ and Node 22.12+ (and links newer ones in `.tools/bin` when the defaults are older), installs every package, makes a private MySQL without `sudo` (or uses yours), creates both settings files with new random keys (and request limits relaxed for development), and loads the demo data; safe to run again; tried on a fresh clone with the computer's old default PHP 8.1 and Node 20. Also: the admin's package list fixed so `npm ci` works, and short money amounts in the admin show `৳12K` in up-to-date browsers (they showed `৳12.0K`); see [Getting started](#getting-started) |
| B25 | Phase 21: sales and cash reports | Done (read-only, nothing to switch on): **Reports** is now a group: *Sales and products* adds sales by payment method (bKash, Nagad and cards through SSLCommerz shown apart) and by delivery zone; *Money in* shows what arrived each day by channel (online providers, cash collected by each courier or by your own staff, gift cards, points) and refunds; *Cash on delivery* shows what each courier collected, its fees, what it paid you and what it still owes, and the orders still to collect; *Courier payments* records each payment a courier sends (Owner only by default: new permission *Record courier payments*), warns about a likely duplicate. CSV downloads open in Excel with Bangla intact. New **Settings → General → Time zone** (UTC until you pick Asia/Dhaka) for every report's days; see [docs/BANGLADESH.md](docs/BANGLADESH.md#cash-reports-and-courier-payments) |

The concepts covered in each phase are listed in [docs/LEARNING_LOG.md](docs/LEARNING_LOG.md). Detailed lessons per phase are in [docs/phases/](docs/phases/).
# BuyNext

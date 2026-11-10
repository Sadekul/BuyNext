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
| B4 | Backend phase 4: admin roles and permissions, content pages, reports, settings | Next; agreement in [docs/backend/PHASE4_CONTRACT.md](docs/backend/PHASE4_CONTRACT.md) |

The concepts covered in each phase are listed in [docs/LEARNING_LOG.md](docs/LEARNING_LOG.md). Detailed lessons per phase are in [docs/phases/](docs/phases/).

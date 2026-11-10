# BuyNest

> Your Modern Shopping Destination

BuyNest is a modern e-commerce web application, built step by step as a professional React learning project.

## Repository layout

```
buynest/
├── frontend/   # React + Vite storefront (phases 1–14 complete) and its server functions (sign-in, admin API)
├── admin/      # React admin dashboard for the shop owner, served at /admin (demo data for now)
├── backend/    # Future Laravel REST API (not started)
├── e2e/        # Real-browser checks for the storefront and the admin dashboard
└── docs/       # Phase lessons, learning log, backend contract, deployment guide, SQA report
```

## How the pieces will connect

```
Admin dashboard ──save──▶ Laravel REST API ──▶ MySQL
                                 │
                          GET /api/products
                                 ▼
                        React BuyNest frontend ──▶ Customer
```

During the learning phases the frontend talks to [DummyJSON](https://dummyjson.com), a public test API.
DummyJSON never persists create/update/delete requests, so it is not a real database.
All API calls go through `frontend/src/services/`. Switching to Laravel means setting `VITE_API_PROVIDER=laravel` and the base URL;
the adapter for the proposed contract already exists. See [docs/backend/](docs/backend/).

## Getting started

```bash
cd admin && npm install && cd ..   # the admin dashboard's packages
cd frontend
npm install
cp .env.example .env.local
npm run dev        # store: http://localhost:5173 · admin: http://localhost:5173/admin/
npm test           # 143 unit tests, offline
```

`npm run dev` also starts the admin dashboard's dev server, so both open from the same address.

| Who | Address | Demo account |
| --- | --- | --- |
| Customers | http://localhost:5173 | any DummyJSON user, e.g. **averyp / averyppass** |
| Shop owner (admin) | http://localhost:5173/admin/ | an account with role "admin", e.g. **emilys / emilyspass** |

Customer accounts get "No admin access" at `/admin`, and the admin API refuses them (403) on every request.
Details: [frontend/README.md](frontend/README.md) · [admin/README.md](admin/README.md) · Deployment: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) · Browser checks: [e2e/README.md](e2e/README.md).

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
| — | Admin dashboard (demo data) | Done: overview, products (add/edit/delete, simulated), orders, customers; see [admin/README.md](admin/README.md) |
| — | Laravel backend + real admin saving | Next project (not started) |

The concepts covered in each phase are listed in [docs/LEARNING_LOG.md](docs/LEARNING_LOG.md). Detailed lessons per phase are in [docs/phases/](docs/phases/).

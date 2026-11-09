# BuyNest

> Your Modern Shopping Destination

BuyNest is a modern e-commerce web application, built step by step as a professional React learning project.

## Repository layout

```
buynest/
├── frontend/   # React + Vite storefront (phases 1–14 complete)
├── backend/    # Future Laravel REST API (not started)
├── admin/      # Future React admin dashboard (not started)
└── docs/       # Phase lessons, learning log, backend contract, deployment guide
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
cd frontend
npm install
cp .env.example .env.local
npm run dev        # http://localhost:5173
npm test           # 94 tests, offline
```

Demo sign-in: **emilys / emilyspass**. Details: [frontend/README.md](frontend/README.md) · Deployment: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

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
| — | SQA & security audit | Done: 16 issues fixed, see [docs/SQA_REPORT.md](docs/SQA_REPORT.md) |

The concepts covered in each phase are listed in [docs/LEARNING_LOG.md](docs/LEARNING_LOG.md). Detailed lessons per phase are in [docs/phases/](docs/phases/).

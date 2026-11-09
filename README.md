# BuyNest

> Your Modern Shopping Destination

BuyNest is a modern e-commerce web application, built step by step as a professional React learning project.

## Repository layout

```
buynest/
├── frontend/   # React + Vite storefront (active development)
├── backend/    # Future Laravel REST API (not started)
├── admin/      # Future React admin dashboard (not started)
└── docs/       # Learning log and project notes
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
All API calls go through `frontend/src/services/`, so switching to Laravel later means changing the base URL
and the data adapters, not every component.

## Getting started

See [frontend/README.md](frontend/README.md) for installation, commands, and architecture.

## Progress

| Phase | Topic | Status |
| --- | --- | --- |
| 1 | Environment and project setup | Done |
| 2 | Components and frontend template | Done |
| 3 | External API integration | Done |
| 4 | Product listing and catalog | Next |
| 5–14 | Details, cart, wishlist, search, auth, checkout, advanced React, backend, testing, deployment | Planned |

The concepts covered in each phase are listed in [docs/LEARNING_LOG.md](docs/LEARNING_LOG.md).

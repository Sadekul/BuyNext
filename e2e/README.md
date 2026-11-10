# BuyNest browser checks

Real-browser checks for the storefront and the admin dashboard, driven through
[playwright-core](https://playwright.dev) using the Chrome already installed on
the machine (nothing extra is downloaded), plus [axe-core](https://github.com/dequelabs/axe-core)
accessibility audits. They complement the unit tests (`npm test` in `frontend/`
and `admin/`), which run without a browser.

## Run

```bash
cd e2e && npm install          # once

# Against the dev server (start it first: cd frontend && npm run dev)
npm test

# Against the production build (cd frontend && npm run build && npm run preview)
npm run test:prod

# One suite
node admin.mjs
BASE_URL=http://localhost:4173 node security.mjs
```

`CHROME_PATH` points at a different Chrome/Chromium binary (default `/usr/bin/google-chrome`).
The checks use the public DummyJSON demo accounts, so they need internet access.

## Suites

| File | What it checks |
| --- | --- |
| `storefront.mjs` | Home, catalog filters/sort/pages and URL state, search suggestions, product page, wishlist, cart and discount codes, checkout to confirmation and order history, phone layout, accessibility |
| `accounts.mjs` | Nothing of one customer survives sign-out, another account signing in, other tabs, or an expired session; guest items move into the account |
| `sessions.mjs` | HttpOnly session cookies, no tokens in browser storage, "Keep me signed in", silent renewal, sign-out races, other websites can't use the session |
| `security.mjs` | Tampered browser data, URL edge cases, Escape in the mobile search, checkout price re-check, coupon lock; on the production build, the Content-Security-Policy on every page of both apps |
| `motion.mjs` | Mini cart, mobile menu, and quick view animate smoothly (no jump back) |
| `admin.mjs` | Admin dashboard: customers are refused (page and API), every admin page, demo edits, phone layout, accessibility, shared sign-out |
| `laravel.mjs` | The storefront on a mock Laravel API (`laravel-mock-server.mjs`) with only settings changed |

`admin.mjs` saves screenshots (`admin-overview-*.png`, not committed).

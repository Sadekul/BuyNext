# BuyNest browser checks

Real-browser checks for the storefront and the admin dashboard, driven through
[playwright-core](https://playwright.dev) using the Chrome already installed on
the machine (nothing extra is downloaded), plus [axe-core](https://github.com/dequelabs/axe-core)
accessibility audits. They complement the unit tests (`npm test` in `frontend/`
and `admin/`), which run without a browser.

## Run

```bash
cd e2e && npm install          # once

# Against the dev server (start everything first: ./dev.sh in the repository root)
npm test

# Against the production build (cd frontend && npm run build && npm run preview)
npm run test:prod

# One suite
node admin.mjs
BASE_URL=http://localhost:4173 node security.mjs
```

`CHROME_PATH` points at a different Chrome/Chromium binary (default `/usr/bin/google-chrome`).

Accounts: by default the checks use **BuyNest accounts** (`E2E_ACCOUNTS=laravel`), so the Laravel API must be running with its local demo accounts (`php artisan db:seed`) and its test inbox (`DEV_MAILBOX=true`), which `signup.mjs` reads the emailed codes from. Against a store set up with the DummyJSON demo users, run with `E2E_ACCOUNTS=dummyjson` (`signup.mjs` is then skipped). The catalog still comes from DummyJSON, so the checks need internet access.

With the BuyNest API the checks place real orders. `npm test` records every product's stock before the suites and puts it back afterwards; run single suites knowing they change stock (reset everything with `php artisan buynest:import-catalog --overwrite` in backend/).

## Suites

| File | What it checks |
| --- | --- |
| `storefront.mjs` | Home, catalog filters/sort/pages and URL state, search suggestions, product page, wishlist, cart and discount codes, checkout to confirmation and order history, phone layout, accessibility |
| `accounts.mjs` | Nothing of one customer survives sign-out, another account signing in, other tabs, or an expired session; guest items move into the account |
| `sessions.mjs` | HttpOnly session cookies, no tokens in browser storage, "Keep me signed in", silent renewal, sign-out races, other websites can't use the session |
| `orders.mjs` | Real orders: guest and customer checkout at server prices, stock reserved and returned, confirmation and shipping emails, order tracking, account order history, someone else's order refused, the admin ships/delivers/marks paid/cancels, a price change mid-checkout stops the order, a Draft product leaves the store |
| `signup.mjs` | Sign-up with name, email, phone; the emailed 6-digit code (wrong and right); profile changes saved; duplicate email; unconfirmed sign-in; password reset by code; the admin sees the new customer; the test inbox |
| `security.mjs` | Tampered browser data, URL edge cases, Escape in the mobile search, checkout price re-check, coupon lock; on the production build, the Content-Security-Policy on every page of both apps |
| `motion.mjs` | Mini cart, mobile menu, and quick view animate smoothly (no jump back) |
| `admin.mjs` | Admin dashboard: separate admin sign-in and cookies, customers refused (sign-in and API), every admin page, demo edits, blocking and unblocking a real customer, phone layout, accessibility, admin and store sessions independent |
| `laravel.mjs` | The storefront on a mock Laravel API (`laravel-mock-server.mjs`) with only settings changed |

`admin.mjs` saves screenshots (`admin-overview-*.png`, not committed).

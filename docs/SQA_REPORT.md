# BuyNest SQA and security audit — 2026-11-09

A full quality and security pass over the storefront after Phase 14. Every finding below was confirmed in the code, fixed, and covered by a unit test, a browser check, or both.

## How it was checked

- **Automated:** `npm audit` (0 vulnerabilities), ESLint (clean), Vitest (111 tests, up from 94), production build.
- **Code review:** two independent read-throughs of `src/`, one for security and one for functional bugs.
- **Real browser (Chrome, Playwright):** 12 earlier suites (378 checks, Laravel mode and the production build included), plus 17 new checks for these fixes and a pass with the production CSP enforced (0 violations, fonts and images load).

## Security findings

| # | Severity | Problem | Fix |
|---|---|---|---|
| S1 | Medium | No Content-Security-Policy, so injected markup could load scripts from anywhere | Build-time CSP `<meta>` in `vite.config.js`. The API origin comes from `VITE_API_BASE_URL`. Zod switched to `jitless`, so it doesn't probe `eval`. |
| S2 | Medium | A tampered cart in localStorage (for example an object in `notice`) crashed the whole app on every load | Every stored cart and wishlist field is type-checked (`utils/storedValues.js`). Added an app-level error boundary with a "reset saved cart" option. |
| S3 | Medium | Checkout's server check compared list price only, so a tampered discount was recorded as "verified" | Discounts are compared too. Checkout also re-checks prices and stock on arrival. |
| S4 | Low | Malformed stored orders broke the orders pages for good | Orders are validated field by field, and bad records are dropped. |
| S5 | Low | Phone number and address persisted in the stored session | Only id, username, names, email and avatar are stored. Pages fetch the rest fresh. |
| S6 | Low | Simultaneous 401s triggered parallel token refreshes, and a refresh finishing after sign-out restored the tokens | One shared refresh at a time. Tokens apply only to the session they were refreshed for. |
| S7 | Low | Demo password in every production bundle | Shown only with the DummyJSON provider. Laravel builds don't contain it. |
| S8 | Hardening | Post-login redirect trusted `location.state` | Only same-site paths are accepted (`//host` and `/\host` are rejected). |

**Checked and clean:** XSS (no raw HTML, no API-controlled links), open redirects, token leakage (now: tokens never leave the server-side sign-in service), the learning lab being excluded from production, prototype pollution, unsafe JSON parsing, regex DoS, and secrets in env files.

## Functional findings

| # | Severity | Problem | Fix |
|---|---|---|---|
| F1 | High | Checkout used the prices and stock saved when items were added, so stale discounts or sold-out items could be ordered | Checkout runs the same price-and-stock refresh as the cart page, explains any change, and keeps "Place order" disabled until the refresh finishes. |
| F2 | Medium | During "Checking prices…" the coupon could still change, and afterwards the whole cart was cleared, including items added meanwhile in another tab | Coupon form locked while placing the order. Only the ordered lines are removed. |
| F3 | Medium | A server error (5xx, 429) or going offline while checking the session signed the customer out | Only 400/401/403 end a session. |
| F4 | Low | Escape in the mobile menu's search closed the whole menu | Escape first closes the suggestions. |
| F5 | Low | Free-shipping hint ignored percent coupons (said "$3.20 more" when $3.56 was needed) | The hint accounts for the coupon. |
| F6 | Low | An impossible price range (min > max) was ignored but still shown as active chips | Chips and the filter count use the same effective filters as the list. |
| F7 | Low | Removing the search or category chip kept the page number | It goes back to page 1. |
| F8 | Low | A signed-in visit to /login briefly showed the form | Waits for the session check, like protected pages. |

## Account separation (follow-up audit)

Reported: wishlist items stayed visible after signing out. A browser audit of everything that could outlive a customer's session (two real accounts, two tabs, an expired session) found:

| # | Problem | Fix |
|---|---|---|
| A1 | Wishlist stayed visible after sign-out | Each account has its own saved wishlist; signed out = empty guest list |
| A2 | Cart stayed visible after sign-out | Same, per-account cart |
| A3 | A different account signing in on the same browser saw the previous customer's wishlist and cart | Lists switch with the account; nothing is copied across accounts |
| A4 | Signing out in one tab left the wishlist and cart on screen in other tabs | The other tab signs out and switches to the guest lists |
| A5 | An expired session kept the account's wishlist and cart on screen | Expiry switches to the guest lists, like a sign-out |
| A6 | Signing in in one tab left other tabs signed out | Other tabs check and adopt the new session (and refreshed tokens) |

Behaviour now: items added as a guest move into the account at sign-in (the larger quantity wins for a product in both carts), the customer's own items come back when they sign in again, and lists saved by the previous version of the site are moved into the signed-in account instead of reappearing after sign-out. Already correct: profile, orders, and account pages (cached per account, filtered by account, or redirected to sign-in).

Checks: `src/hooks/usePersistentReducer.test.js`, merge tests in the reducers, and an 18-check browser audit.

## Former known limits (resolved)

| # | Was | Now |
|---|---|---|
| K1 | Sign-in tokens were kept in Web Storage, readable by any script on the page | A same-origin sign-in service (`server/authBff.js`, runs as a Vercel/Netlify function and inside Vite) keeps them in `HttpOnly; Secure; SameSite=Strict; Path=/api/auth` cookies. No token reaches JavaScript or storage; requests from other websites are refused and never carry the cookies. "Keep me signed in" = 7-day cookies, otherwise they end with the browser. Older token-bearing sessions are deleted on first load. |
| K3 | Each account's saved cart, wishlist and demo orders stayed in the browser after sign-out | Without "Keep me signed in", they are deleted when the session ends: on sign-out, on expiry, and on the next visit after the browser was closed. With it, they're kept for the next sign-in (a trusted device). Orders are now saved per account, so exactly one customer's are removed. |

Two bugs found while verifying K1/K3, both fixed with regression tests:
- A reload immediately after signing in could forget "Keep me signed in" (the name cache wasn't written yet), so sign-out deleted a remembered account's items. The choice now travels in the session cookie itself.
- Signing out and reloading (or closing the tab) immediately could cancel the sign-out request and leave the session alive. Sign-out now deletes the session hint at once and sends the request with `keepalive`; 8/8 instant-reload and 8/8 instant-close runs ended fully signed out.

DummyJSON check behind this design: it reflects any `Origin` with `Access-Control-Allow-Credentials: true`, so a plain proxy of its API on our domain would have let other websites try credentialed reads. The service only exposes five sign-in endpoints, rejects `Sec-Fetch-Site: cross-site`, and sends no CORS headers.

## Admin dashboard round — 2026-11-10

Built: the shop owner's dashboard (`admin/`, at `/admin/`) on demo data, with an admin API (`frontend/server/adminApi.js`) that checks the role on every request. Found and fixed while verifying it:

| # | Severity | Problem | Fix |
|---|---|---|---|
| D1 | Medium | The sign-in service passed DummyJSON's full user record to the browser: password, card, bank, SSN, IP (the storefront dropped them, but any script on the page could have read them) | The server sends only allow-listed profile fields (`safeProfile`); customer lists in the admin are allow-listed too |
| D2 | Medium | Signing in, then reloading straight away, could lose the cart filled before signing in (the guest copy was deleted before the merged account copy was saved) | The merged copy is written first, the guest copy removed second; regression test proves the order |
| D3 | Medium | Prices like 19.99 failed "at most 2 decimals" (19.99 × 100 = 1998.9999… in floating point), in the browser and on the server | Compared with a tolerance in both places; 19.99, 0.1, 1234.56 accepted, 19.999 rejected |
| D4 | Low | Right after signing in, the app didn't know the account's role (DummyJSON's login reply omits it), so admins saw no "Shop admin" link until a reload | The sign-in service returns the full safe profile at sign-in |
| D5 | Low | The account area scrolled sideways on phones once a fourth link was added | The layout column is capped at the screen width; the links wrap |
| D6 | Low | Admin pages: phone layout overflow (grid column and a hidden table label), a 4.41:1 badge contrast, missing `main` landmark on sign-in | Fixed; axe reports 0 violations on all admin pages, no sideways scroll at 390px |

Checks: frontend 143 unit tests (20 of them for the server services), admin 8 unit tests, and the browser checks in `e2e/` (storefront, accounts, sessions, security, motion, admin, Laravel mode), against both the dev server and the production build.

## Backend phase 1 (accounts) — 2026-11-10

Built: the Laravel API (`backend/`) with real customer accounts (sign-up with name, email, phone, password; a 6-digit email code; password reset by code) and separate admin accounts; the sign-in service and both React apps switched to it with `VITE_ACCOUNTS_BACKEND=laravel`. Design and reasoning: [backend/ACCOUNTS.md](backend/ACCOUNTS.md). Found and fixed while verifying it:

| # | Severity | Problem | Fix |
|---|---|---|---|
| A1 | Medium | A customer token on `/api/admin/v1/customers/{id}` got 404 or 403 depending on whether that id existed (the record was looked up before the customer/admin check), so a customer could map customer ids | The token-kind check runs before route-model binding (middleware priority); every id gets 403 |
| A2 | Medium | The general API rate limit grouped every signed-in user under one key (operator precedence), so one busy account could slow everyone | Keyed per account type and id, or per IP when signed out |
| A3 | Medium | Every request reached Laravel from the sign-in service's address, so sign-in rate limits would have counted all visitors together (one attacker could lock everyone out) | The service passes the visitor's IP with a shared key; Laravel only trusts it with the key, and the dev server takes the IP from the connection, never from browser headers |
| A4 | Low | A rate limit read `env()` outside the config files, which stops working once settings are cached in production | Moved into `config/buynest.php` |
| A5 | Low | Admin "Block" buttons had their hidden name joined without a space by some screen-reader engines ("BlockNadia Rahman") | Explicit `aria-label` ("Block Nadia Rahman") |
| A6 | Low | Checkout assumed every account has a saved address (DummyJSON users do); new customers have none | Works as intended (the form asks for it); browser checks now fill the address like a shopper |

Also by design: admins and customers are separate tables, tokens, and cookies (the storefront's "Shop admin" link is gone; admins sign in at `/admin/login`); the old cross-app sign-out signal was removed.

Checks: backend 39 feature tests (MySQL test database), frontend 168 unit tests (35 for the server services), admin 12, and the browser checks in `e2e/`, now with `signup.mjs`, against BuyNest accounts on both the dev server and the production build.

## Backend phase 2 (catalog and real orders) — 2026-11-10

Built by two agents in parallel against [backend/PHASE2_CONTRACT.md](backend/PHASE2_CONTRACT.md), then integrated and verified: products in MySQL (194 imported from DummyJSON, same ids), server pricing in integer cents (checked against the storefront's own math on 533,530 price/discount pairs), orders with stock reserved in a locked transaction, guest checkout and order tracking, order emails, and admin product and order management. Found and fixed during integration:

| # | Severity | Problem | Fix |
|---|---|---|---|
| O1 | Medium | The public catalog answer carried Laravel's pagination `meta.path` and `meta.links`, which reveal the API's internal address | The service passes only the page numbers; a test checks the internal address never appears |
| O2 | Medium | Updating only the note of an already-cancelled order put its stock back a second time | Stock is returned only on the change to cancelled (backend test) |
| O3 | Medium | The Vercel admin function didn't accept PATCH, so blocking customers would have failed once deployed | PATCH added; catalog and shop functions added for Vercel and Netlify |
| O4 | Low | The order confirmation used `<header role="status">` (not an allowed role for a header) | A `div` carries the status role (axe clean) |
| O6 | Test hygiene | Real test orders used up real stock: product 1 (minimum order 48) fell from 99 to 3 over two runs, after which the store rightly called it unavailable and a check failed | Stock reset with `buynest:import-catalog --overwrite`; the full browser run now records every product's stock first and puts it back afterwards |
| O5 | Test hygiene | The admin browser checks edited and deleted product 1 and added a product: harmless on DummyJSON, but real changes on the store's database | Restored product 1; the checks now create their own Draft product and only change and delete that one |

Behaviour decided on the way: a 401 on a customer's order renews the session once and retries (never silently turns into a guest order); stock and minimum-quantity problems stay visible in the cart total but block the order; with real data the admin's search and category filters combine.

Checks: backend 79 feature tests; frontend 190 unit tests (47 for the server services); admin 17; browser checks with the new `orders.mjs` (guest and customer orders, stock, emails, tracking, someone else's order refused, admin ship/deliver/paid/cancel with restock, price change mid-checkout, Draft products hidden).

## Backend phase 3 (invoices, shipments, refunds, coupons) — 2026-11-11

Built by two agents in parallel against [backend/PHASE3_CONTRACT.md](backend/PHASE3_CONTRACT.md) (both were paused by the usage limit and resumed where they stopped), then integrated and verified. Refund math is in integer cents: each line's share of the order coupon is split so the shares add up exactly to the discount, and a full refund always equals what was paid, whatever order units are refunded in. Coupon use is counted inside the checkout transaction with a row lock (three parallel checkouts on a single-use code: one order, two refusals) and released when an order is cancelled.

| # | Severity | Problem | Fix |
|---|---|---|---|
| P1 | Medium | Orders marked paid in phase 2 had no invoice, so phase 3 saw them as paid $0: they couldn't be refunded, and a second invoice could be created for them | Migration gives each one its missing invoice; invoicing is refused for any order whose payment is already recorded (tests for both) |
| P2 | Low | Customer-visible shipment and invoice data could have included the admin's name and internal notes | Customers see notes only when they were emailed, never the admin's name |
| P3 | Test | The refund check assumed refunding the only unit closes the order; shipping still had to be refunded | Correct behaviour; the check refunds the shipping too |

Checks: backend 108 feature tests; frontend 205; admin 24; browser checks with the new `documents.mjs`.

## Backend phase 4 (roles, audit, content, reports, settings) — 2026-11-12

Built by three agents in parallel (backend; admin app with the sign-in service; storefront) against [backend/PHASE4_CONTRACT.md](backend/PHASE4_CONTRACT.md), then integrated and verified. Security points checked in the browser: a Sales staff admin's menu, pages, and API calls are limited (403 `permission_denied` naming the permission); a test fails if any admin route lacks a permission; content HTML with a script, an `onclick`, and a `javascript:` link is cleaned on save and nothing runs in the store; the audit log never stores passwords; deactivating an admin signs them out; CSV exports guard against formula injection.

| # | Severity | Problem | Fix |
|---|---|---|---|
| R1 | Medium | With `admins.manage`, an admin could have given themselves the Owner role | Only an Owner can give the Owner role or change an Owner's account (backend rule and tests) |
| R2 | Medium | The longer admin menu didn't fit a 900 px-tall screen: the sidebar couldn't scroll, so the account links spilled out of it (unreadable, and unreachable on shorter screens) | The sidebar scrolls within itself on its own dark background |
| R3 | Low | Accessibility on the new admin screens: the role label's contrast (3.75:1), banner title fields without a label (an `id` override broke the label link), and the "You don't have access" page without a level-1 heading | Fixed; axe clean on every new admin screen |
| R4 | Low | The store's tax line would always have shown $0: the sign-in service didn't forward the shipping country, nor the `guest_checkout_disabled` code | Both forwarded, with tests |
| R5 | Test | Two storefront unit tests failed once while the machine was busy and passed in eight reruns, including under load | Not reproducible; watch for timing-sensitive tests |

Checks: backend 162 feature tests; frontend 233 unit tests; admin 37; browser checks with the new `system.mjs`.

## Backend phase 5 (Magento-style catalog) — 2026-11-16

Built by three agents in parallel (backend; storefront with the sign-in service and `/media`; admin app with its sign-in service routes) against [backend/PHASE5_CONTRACT.md](backend/PHASE5_CONTRACT.md), then integrated and verified with the new `catalog.mjs` browser suite. Security points checked: uploads are accepted only when the file's contents really are JPEG, PNG, or WebP (a `.jpg` holding PHP or SVG is refused) and are stored under random names; `/media` serves only names the API creates; CSV exports guard against formula injection and imports are all-or-nothing; review text is plain text, one review per customer per product, rate-limited; every new admin route names a permission, and a Viewer is refused by the API (not only by hidden buttons).

| # | Severity | Problem | Fix |
|---|---|---|---|
| S1 | Medium | The admin order page, refund form, credit memos, and invoices didn't show which variant was ordered: two sizes of one shirt looked identical when refunding | The variant label is shown everywhere in the admin, and the refund field names it |
| S2 | Low | Two variants of one product on an order gave duplicate React keys (console errors) on the admin order page | Keys include the SKU and line position |
| S3 | Low | Alt text written for a product photo in the admin never reached the store's gallery | Kept by the store's adapter and used by the gallery |
| S4 | Low | The admin's shared error text was 4.4:1 contrast, just under AA | Darkened to 4.5:1 for every admin error message |
| S5 | Low | In development, the server read any request body into memory with no size limit (production functions already capped it) | The dev and preview server refuse bodies over 61 MB |
| S6 | Test | The browser suites timed out when run back to back: the development API ran one PHP worker, and every test used one admin account, so requests queued and hit the 240-per-minute limit | `./dev.sh` starts the API with 4 workers; the API and review limits are settings (`BUYNEST_API_PER_MINUTE`, `BUYNEST_REVIEWS_PER_HOUR`, unchanged in production, relaxed in the local `.env`); the stock helper waits and retries when asked to slow down |
| S7 | Test | An admin-user test searched for "old", which a random test name sometimes also contains | The search term is now unique |

Checks: backend 212 feature tests; frontend 294 unit tests; admin 57; browser checks 450 on the dev server and 443 on the production build (new `catalog.mjs`: 116).

## Known limits (by design, documented)

- In the DummyJSON demo mode, orders, payment, and stock are still simulated in the browser.
- With `VITE_API_PROVIDER=laravel` and `VITE_ACCOUNTS_BACKEND=laravel` accounts, catalog, and orders are real. No payment provider is connected yet: card and PayPal orders wait as "Awaiting payment" until an admin creates the invoice, and refunds record money the shop returns by the original method. Tax is 0 until phase 4.
- Changing the account email isn't offered yet: a new address must be confirmed by code first (planned with the address book).
- The Vercel and Netlify function wrappers (sign-in and admin API) are verified locally only; confirm sign-in and `/admin/` once after the first deploy (see `docs/DEPLOYMENT.md`).
- The local database keeps a few records from the agents' and browser checks' verification: test orders and invoices, deactivated test admins (for example "Verify Viewer" and "Smoke Sales"), and disabled test coupons.
- Products deleted in the admin are soft-deleted (kept for past orders); the browser checks leave their own deleted Draft test products behind in the local database (the catalog suite parks them in Home decoration before deleting them, because a deleted product still keeps its category).

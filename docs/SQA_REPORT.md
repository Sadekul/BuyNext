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

## Known limits (by design, documented)

- Orders, payment and stock are simulated in the browser (K2: kept simulated by decision, until the Laravel backend). The Laravel backend must recompute every amount on the server; the frontend checks only protect honest customers from stale data.
- In Laravel mode, sign-in still goes through the DummyJSON sign-in service until Laravel's Sanctum endpoints exist (see `docs/backend/API_CONTRACT.md`).
- The Vercel and Netlify function wrappers (sign-in and admin API) are verified locally only; confirm sign-in and `/admin/` once after the first deploy (see `docs/DEPLOYMENT.md`).
- Admin edits are simulated: DummyJSON accepts product changes but never stores them, and the store's demo orders live in each customer's browser, so the admin can't list them. Both change with the Laravel backend.

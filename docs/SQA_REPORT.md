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

**Checked and clean:** XSS (no raw HTML, no API-controlled links), open redirects, token leakage (Bearer header to the API only, refresh token in the POST body), the learning lab being excluded from production, prototype pollution, unsafe JSON parsing, regex DoS, and secrets in env files.

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

## Known limits (by design, documented)

- Tokens live in Web Storage because DummyJSON is token-based. The Laravel plan uses an HttpOnly session cookie (see `docs/backend/API_CONTRACT.md`).
- Orders, payment and stock are simulated in the browser. The Laravel backend must recompute every amount on the server; the frontend checks only protect honest customers from stale data.
- Demo orders (with contact details), and each account's saved cart and wishlist, stay in this browser's storage after sign-out (never shown to anyone else) because DummyJSON has nowhere to keep them. They move server-side with Laravel.

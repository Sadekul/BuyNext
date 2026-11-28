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

## Backend phase 6 (customers and sales) — 2026-11-16

Built by three agents in parallel (backend; storefront with its sign-in service routes; admin app with its routes) against [backend/PHASE6_CONTRACT.md](backend/PHASE6_CONTRACT.md), then verified with the new `customers.mjs` browser suite (address book, group pricing end to end, staff-created customers setting their own password by code, phone orders, bulk invoice and ship, the full return → refund flow, a Viewer's limits). Security points checked: customers only reach their own addresses and returns (another customer's id answers 404); admins never see or set customer passwords; changing a customer's email signs them out and requires a new code; staff-only payment methods are refused on the storefront; returns can't exceed what was shipped minus what was already returned or refunded, and stock is restocked only once; every new admin route names a permission.

| # | Severity | Problem | Fix |
|---|---|---|---|
| C1 | Medium | The automatic cleanup of unconfirmed sign-ups would have deleted a real customer a week after an admin changed their email (the change makes the email unconfirmed again) | Only accounts that were never confirmed, never signed in, have no orders, and weren't created by staff are cleaned up |
| C2 | Test | The account separation check assumed the second test shopper had no orders at all, which phase 6's tests changed | It now checks that none of the first shopper's orders (87) appear for the second |

Checks: backend 250 feature tests; frontend 337 unit tests; admin 78; browser checks 611 on the dev server and 604 on the production build (new `customers.mjs`: 161).

## Backend phase 7 (marketing and system) — 2026-11-16

Built by five agents in parallel (two backend; storefront with its sign-in service routes; two admin) against [backend/PHASE7_CONTRACT.md](backend/PHASE7_CONTRACT.md), then verified with the new `marketing.mjs` browser suite. Security and privacy points checked: the newsletter sign-up answers the same for known and unknown emails, needs a confirmation link, and every newsletter carries a signed unsubscribe link and a `List-Unsubscribe` header; email templates refuse unknown variables, require the code or link an email needs, and escape inserted values; campaign and template HTML is cleaned on the server and previewed in a sandboxed frame; search terms are counted without storing who searched; a saved cart is merged into another device exactly once; every new admin route names a permission.

| # | Severity | Problem | Fix |
|---|---|---|---|
| M1 | Medium | After the move to editable templates, the plain-text part of code emails had lost the "Your code:" label (the code stood alone on a line) | The three code emails label the code in both parts |
| M2 | Medium | A signed-in shopper who emptied the cart from the drawer got the old items back at the next sign-in (the server only saved carts it priced) | Emptying the cart tells the server, with a test |
| M3 | Medium | The Marketing role couldn't load the customer group, category, and product pickers its rule and coupon forms need | Those three lists accept any of several permissions (`can.admin:a\|b`); Marketing still can't see customers |
| M4 | Low | A group member's cart line was labeled with a store-wide sale's name when a group-only rule also applied | Labeled "<group> price" whenever a group rule took part |
| M5 | Low | The search box's suggestions recorded every partial word ("ip", "iph") in the Search terms report | Suggestions send a `suggest` flag and aren't recorded, with a test |
| M6 | Low | The test inbox recorded the `List-Unsubscribe` header but didn't show it | Shown in the inbox page and its JSON |
| M7 | Low | The Admin users page had no search or status filter, so once the staff list passed one page an admin could only be found by paging (the browser check for a newly created admin failed for that reason) | Search by name or email and an Active/Deactivated filter, like the other grids |
| M8 | Test | Saved carts (phase 7) carried items from one browser suite into the next; the dashboard redesign and the renamed "All customers" menu entry broke older checks; a checkout unit test typed slower than its time limit under load; the guest-items check read the header before the items moved over | Each suite starts with both test shoppers' saved carts emptied; checks updated to the new design with exact link names; longer limits for form-typing tests; the check waits up to 5 s |

Checks: backend 305 feature tests; frontend 408 unit tests; admin 107; browser checks 798 on the dev server and 791 on the production build (new `marketing.mjs`: 187).

## Phase 8 (Stripe payments, real email, Railway hosting) — 2026-11-16

Built by three agents in parallel (backend; storefront, admin, and sign-in service; Docker, Railway, and email guides) against [backend/PHASE8_CONTRACT.md](backend/PHASE8_CONTRACT.md), then verified with the new `payments.mjs` browser suite, which starts a stand-in Stripe server and its own API and store, so nothing calls Stripe and no settings file changes. Security points checked: card details never reach BuyNest (Stripe's hosted page); a webhook is accepted only with a valid Stripe signature from the last 5 minutes, and each event is handled once; the paid amount and currency must equal the order's; refunds go to Stripe first and nothing is saved if Stripe refuses; only `https` payment links reach the browser; the store forwards webhooks byte for byte and never passes on a key header from the browser.

| # | Severity | Problem | Fix |
|---|---|---|---|
| P1 | Medium | The API needs a public address on Railway (the store's server functions run on Vercel), so anyone who found it could call it directly | With `BUYNEST_REQUIRE_BFF_KEY=true` (set in the Railway guide) every `/api` request without the store's shared key gets 403; `/up` and photos stay open. The store now sends the key on every call. Tests added; checked against the dev servers |
| P2 | Low | An order cancelled because its payment page expired still said "Your order is confirmed" on its confirmation page | It shows "Order cancelled", that the items were released, and "Nothing was charged" |
| P3 | Low | PHP-FPM in the new image wouldn't start with fewer than 4 workers configured | Minimum lowered to 2 (found by running the web server setup locally) |
| P4 | Test | The marketing suite counted 11 email templates; phase 8 adds a 12th ("Payment not completed") | Count updated |

Checks: backend 332 feature tests; frontend 432 unit tests; admin 111; browser checks 880 on the dev server and 874 on the production build, all passing after the count update (new `payments.mjs`: 83). The Docker image itself wasn't built (Docker isn't installed here); its web server setup was checked with the local nginx and PHP-FPM.

## Phase 9 (launch readiness and self-service) — 2026-11-17

Built by four agents in parallel (two backend; storefront with its sign-in service routes; admin) against [backend/PHASE9_CONTRACT.md](backend/PHASE9_CONTRACT.md), then verified with the new `launch.mjs` browser suite (158 checks). Security points checked: two-step codes follow RFC 6238 (checked against the RFC's test values), can't be replayed, and a sign-in challenge expires after 5 minutes or 5 wrong codes; secrets are encrypted and recovery codes hashed; while two-step is required, a half-signed-in admin can only reach the setup pages; session cookies stay HttpOnly; an email change only happens after the new address proves itself, and the old address is told; data export contains only the customer's own data; account deletion keeps orders for the accounts without the person; error reports are scrubbed (path only, no query strings, emails and card-like numbers masked) and need the store's key; backup downloads use short-lived signed links and are Owner-only; the database password never appears on a command line. New packages (`sentry/sentry-laravel`, `league/flysystem-aws-s3-v3`, `bacon/bacon-qr-code`): `composer audit` and `npm audit` found no known vulnerabilities.

| # | Severity | Problem | Fix |
|---|---|---|---|
| L1 | Medium | On Vercel, the address book's edit and delete would have failed: the store's `/api/shop` function only accepted GET and POST (phase 6, only visible once hosted) | PATCH and DELETE added to the function |
| L2 | Low | If loading the admin's account failed right after setting up two-step (a network blip), the admin was signed out and had to sign in again with a code | Retries a few times, then offers "Try again"; signs out only when the session itself is gone; unit test added |
| L3 | Low | On the Reports page at phone width, the Best sellers, Customers, Coupons, and Low stock tables scroll sideways but couldn't be reached with the keyboard (axe `scrollable-region-focusable`) | Those panels can take focus, so arrow keys scroll them |
| L4 | Test | Phase 9 changed three behaviours older browser checks relied on: 17 email templates, sold-out options can be chosen (to ask for an alert), and test admins named "… Staff" matched a loose audit-log check; two unit tests checked focus one animation frame too early, and one long two-step flow exceeded 5 s under load | Checks updated; focus checks wait; longer limit for the long flow |

Checks: backend 400 feature tests; frontend 501 unit tests; admin 130; browser checks 1,039 on the dev server and 1,032 on the production build, all passing (new `launch.mjs`: 158).

## Phase 10 (search, PDF documents, PayPal, shipping rates, gift cards, analytics) — 2026-11-18

Built against [backend/PHASE10_CONTRACT.md](backend/PHASE10_CONTRACT.md), then verified with the new `extras.mjs` browser suite (164 checks). It runs its own API and store with stand-ins for PayPal and Google, so no real account is called. Security points checked: gift card codes are stored hashed, and balances are locked while an order spends them, so one card can't be spent twice at the same moment. PayPal webhooks are verified with PayPal before anything changes, and an order is only marked paid when the captured amount matches. A guest's PDF download needs both the order number and the order's email. Analytics loads nothing until the visitor accepts cookies (Consent Mode v2 defaults to denied), and Google is only allowed in the Content-Security-Policy when GA4 is turned on. New packages (`barryvdh/laravel-dompdf`): `composer audit` and `npm audit` found no known vulnerabilities.

| # | Severity | Problem | Fix |
|---|---|---|---|
| X1 | Medium | A guest's invoice PDF link put the order email in the address (`?email=`), so it could end up in server logs and browser history | The sign-in service now sends it in an `X-Order-Email` header; the API accepts the header; tests updated |
| X2 | Low | The "payment not completed" email still said "card payment" and named Stripe, which is wrong for a PayPal order | Wording made neutral ("online payment") |
| X3 | Test | Checkout unit tests were flaky under load: they filled the form and clicked before the 600 ms price re-check finished | Helpers wait for "Checking prices…" to clear; longer test limits; 6 runs in a row green |
| X4 | Test | The marketing browser check expected a fixed number of email templates; phase 10 added more | It now compares with the number the API lists |
| X5 | Environment | After a system update to MySQL 8.4.13, the project's own MySQL (8.4.11) crashed on start | Data backed up, the project's copy updated to 8.4.13; data upgraded cleanly with nothing lost |

Checks: backend 451 feature tests (Pint clean); frontend 568 unit tests; admin 143; browser checks 1,203 on the dev server and 1,196 on the production build, all passing (new `extras.mjs`: 164). Not automated: the PDF attached to the invoice email (the test inbox keeps no attachments; backend tests cover it), and PayPal's unpaid-order expiry and amount-mismatch cases (backend tests cover both).

## Phase 11 (wishlists, comparison, linked products, reward points, display currencies) — 2026-11-18

Built by three agents in parallel (backend; storefront with its sign-in service routes; admin with its proxy routes) against [backend/PHASE11_CONTRACT.md](backend/PHASE11_CONTRACT.md), then reviewed and verified with the new `loyalty.mjs` browser suite (130 checks). Free features only: no outside service or paid account. Security points checked: a shared wishlist link is a 32-character random token stored only as a hash, can be regenerated or turned off, and the shared page and its API answer never show the owner's email, last name or ids. Reward point balances change in one service with the customer row locked, never go below 0, and each earning (per order, sign-up, review) can only happen once, enforced by a unique key. Spending is checked on the server (balance, minimum, maximum share of the order, signed-in only). Balance adjustments need `rewards.manage` and a reason and are audited. Display currencies only change what shoppers see: orders, invoices, PDFs and emails stay in USD, and the cart and checkout say so. No new packages.

| # | Severity | Problem | Fix |
|---|---|---|---|
| Y1 | Low | The mini cart (drawer) showed prices in the chosen currency without saying the shopper pays in USD (the cart page and checkout did) | The drawer shows "Prices in BDT are approximate. You'll be charged in USD." (no amount there, because shipping isn't known yet) |
| Y2 | Low | The API could duplicate a product, but the admin had no button for it | "Duplicate" on the product page (`products.edit`) opens the draft copy and says what wasn't copied; unit and browser tests |
| Y3 | Low | Product CSV import reported skipped values (for example an unknown SKU in a related-products column) but the admin didn't show them | Listed on Import / Export as "Skipped values"; they don't block the import; unit tests |
| Y4 | Test | The wishlist now lives on the server, so items one browser run saved for the demo customer were still there in the next run (the production-build run found 4 instead of 1) | The browser suites' setup now empties the demo customers' server wishlists (and turns sharing off) along with their saved carts |
| Y5 | Test | The customers suite sometimes stopped early under load: the admin's address form shows a text box for Country until the country list loads, and the check chose from it before the list arrived | The check waits for the Country list (a combobox) before choosing; passed on the dev server and the production build |
| Y6 | Test | Phase 11 added fields to several answers that older backend tests compared exactly (cart and order totals, refunds, credit memos, import report, store settings, the Marketing role) | Expectations updated to include the new fields; behaviour with rewards off is unchanged |

Checks: backend 474 feature tests (Pint clean, `composer audit` clean); frontend 641 unit tests plus 297 sign-in service tests; admin 164; browser checks 1,333 on the dev server and 1,326 on the production build, all passing (new `loyalty.mjs`: 130). Not automated in the browser (covered by unit or backend tests): the customers grid Points column and the two new reports, points plus gift card on one order, full cover by points, sign-up and review bonuses, and CSV import/export of specifications and links.

## Phase 12 (taka as the store currency, bKash / Nagad through SSLCommerz) — 2026-11-19

Built by three agents in parallel (backend; storefront with its sign-in service routes; admin with its proxy routes) against [backend/PHASE12_CONTRACT.md](backend/PHASE12_CONTRACT.md), then verified with the new `taka.mjs` browser suite (131 checks). It runs its own API with `BUYNEST_CURRENCY=BDT`, its own store, and a stand-in SSLCommerz with a hosted gateway page on HTTPS, so no real account is used. Security points checked: the status the shopper's browser posts back is never trusted; every payment is validated with SSLCommerz on the server (status, transaction id, currency and amount), and a forged "VALID" with an invalid validation id is refused both on the return trip and as an IPN. IPNs need a correct `verify_sign`, are validated again, and are idempotent. The return trip works without the session cookie (cross-site POST, answered with a 303). Risky payments are held for review instead of invoiced. Expiry asks SSLCommerz before cancelling, and refunds go to SSLCommerz first (a refusal saves nothing). Each order keeps its own currency, a gift card can't pay in another currency, and the price conversion command has a dry run, refuses to run twice or with the wrong setting, and converts gift card balances to the paisa so no customer loses money. New files: the Noto Sans Bengali font (SIL Open Font License, bundled for the PDFs). No new packages; `composer audit` and `npm audit` clean.

| # | Severity | Problem | Fix |
|---|---|---|---|
| T1 | Medium | The PDF font (DejaVu Sans) has no taka sign, so `৳` amounts would print as empty boxes in invoices and credit memos | Noto Sans Bengali bundled as a fallback font for the PDFs; a test checks it is embedded |
| T2 | Low | The announcement strip at the top of the store always said "Free standard shipping on orders over $50" (hard-coded), whatever the currency or threshold | It uses the store's free-shipping threshold and currency, and is hidden when there is none; unit test |
| T3 | Low | A forged SSLCommerz IPN with an invalid validation id was answered "unknown order" instead of "invalid" (nothing was ever marked paid) | Answered "invalid" when SSLCommerz doesn't confirm the payment; backend test |
| T4 | Test | The extras suite's consent part once timed out loading its first page during a full run (never alone) | That page gets a longer load allowance |
| T5 | Note | Run by an AI agent, Laravel shortens console output (drops `→` arrows and table padding) | Not a bug: run normally, `buynest:currency:convert` prints the arrows |

Checks: backend 499 feature tests (Pint clean); frontend 692 unit tests (including the sign-in service tests); admin 180; browser checks 1,464 on the dev server (1,438 in the full run plus the extras suite rerun alone after its one timeout) and 1,457 on the production build, all passing (new `taka.mjs`: 131). Not automated in the browser: the PDF attached to the invoice email, admin-created SSLCommerz orders and their payment links, the "processing" refund answer, and a gateway refusal when opening a session. Backend tests cover payment links, the "processing" refund and the gateway refusal; an admin-created SSLCommerz order has no dedicated test (it uses the same payment link path).

## Phase 13 (the store in Bangla and English) — 2026-11-23

Built by three agents in parallel (backend; storefront with its sign-in service; admin with its proxy routes) against [backend/PHASE13_CONTRACT.md](backend/PHASE13_CONTRACT.md), resumed after usage limits and two session cut-offs (four backend files were found cut off at 0 bytes and rewritten; every touched file was checked), then verified with the new `bangla.mjs` browser suite (114 checks). Free: no outside service. Translation library: i18next + react-i18next (pinned versions in [I18N.md](I18N.md)); Bangla loads as its own chunk only when chosen. Checks: every key exists in both languages with the same variables; Bangla pages render with no leftover English sentences; the language is chosen from the cookie, then the account (which wins after sign-in), then the store default, never guessed from the browser; untranslated content falls back to English per field and is marked `lang="en"`; API validation and shopper messages come back in Bangla; emails and invoice PDFs follow the customer's or order's language; Bangla money has the same layout everywhere (৳১,২৫০.০০). No new backend packages; `composer audit` and `npm audit` clean.

| # | Severity | Problem | Fix |
|---|---|---|---|
| G1 | Medium | One "Add to cart" click added several units: the catalog imported DummyJSON's random `minimumOrderQuantity` (156 of 196 products above 1; Apple Airpods 4), reported by the user | Every product reset to a minimum of 1 (migration), the importer no longer copies the demo minimums (test), and a product with a real minimum set by staff says so on its card before the click ("Minimum order: 4 (adds 4 at once)"; unit test) |
| G2 | Medium | A new visitor in a store whose default language is Bangla could keep seeing English product names: cached product, category and content data didn't record their language | The language is part of those query keys, so Bangla and English are cached apart and a page asks for its own language |
| G3 | Low | The home page's free-shipping benefit and the demo hero said "$50" (in Bangla "$৫০") whatever the store's threshold and currency | They use the store's threshold in the store's currency and the shopper's language, or name no amount when there is none; unit test |
| G4 | Low | On phones, the cart page scrolled sideways (29 px in Bangla, 12 px in English): its layout column had no width rule, so the order summary pushed it wider | `minmax(0, 1fr)` column; unit test reads the rule |
| G5 | Low | Bangla money from the browser's own Bangla format (`১,২৫০.০০৳`, lakh grouping) differed from emails and PDFs (`৳১,২৫০.০০`) | One layout everywhere: symbol first, groups of three, Bangla digits when on; unit test |
| G6 | Test | The shared demo account `customer@buynest.test` was switched to Bangla by a person browsing with it; since the language follows the account, every suite signing in with it saw Bangla pages and couldn't find English buttons | The suites' setup resets the demo accounts' language (with their saved carts and wishlists) |
| G7 | Test | New Bangla twin fields ("Meta title in Bangla", "Name in Bangla") matched older checks that looked for labels containing "Meta title" / "Name" / "Subject" | Those checks match the exact label |
| G9 | Test | Under a full production-build run, the taka suite once clicked "Continue to SSLCommerz" in the moment it was disabled for a price re-check (also seen once while it was written) | The step waits for the button to be enabled and clicks again only if nothing happened and the button is enabled (never two orders) |
| G8 | Test | "Delivered and paid" was checked one second after creating the invoice (which also renders the PDF and sends the email) | The check waits for the order's state (up to 15 s) |

Checks: backend 535 feature tests (Pint clean); frontend 766 unit tests (including the sign-in service tests); admin 194; browser checks 1,578 on the dev server and 1,571 on the production build (1,566 in the full run, plus the marketing and taka suites rerun alone after one timeout each under full load), all passing (new `bangla.mjs`: 114). Not automated in the browser: the admin's Bangla forms for categories, pages and home content (set through the API in the suite), option and value names in Bangla, editing a customer's language in the admin, saving or resetting a Bangla email template, the CSV `*_bn` columns, and how well dompdf draws Bangla conjuncts (a known dompdf limit: conjuncts show a visible hasanta, documented in I18N.md). The Bangla wording itself still needs a native speaker's review.

## Phase 14 (Bangladesh delivery and cash on delivery) — 2026-11-24

Built by three agents in parallel (backend; storefront with its sign-in service; admin with its proxy routes) against [backend/PHASE14_CONTRACT.md](backend/PHASE14_CONTRACT.md), then verified with the new `delivery.mjs` browser suite (175 checks). Free: no outside service (places data from nuhil/bangladesh-geocode, MIT, kept in `backend/database/data/bd-geo/`). Checks: Division → District → Area pickers in both languages; local Bangladesh mobiles (`01712 345678`) accepted and stored as `+8801712345678`; delivery zones (Inside Dhaka, Dhaka suburbs, Outside Dhaka as the fallback) with their own prices and delivery days; cash on delivery limits, fee, zones, advance delivery charge through SSLCommerz (stand-in), the phone confirmation queue, collecting the cash (short collections stay due), packing slips and the courier CSV (UTF-8 with BOM). Nothing changes for addresses outside Bangladesh or with the default settings. No new backend packages.

| # | Severity | Problem | Fix |
|---|---|---|---|
| H1 | Medium | The places dataset lists Dhaka's metro thanas only through post offices, so 32 inside-Dhaka thanas (for example Banani, Gulshan, Uttara) were missing from the Area picker | 32 thanas added with Bangla names (`dhaka-metro-thanas.json`, listed in BANGLADESH.md for review); migration reruns the seeders; places cache version bumped; test (54 Dhaka areas, 49 inside Dhaka) |
| H2 | Medium | Once cash on delivery was limited to some delivery zones, a customer outside Bangladesh (no zone) could not choose cash on delivery at all | Zone rules for cash on delivery apply to Bangladesh addresses only; test |
| H3 | Medium | Once Standard had a Bangladesh zone price, customers outside Bangladesh were offered no Standard delivery (all its rows were zone rows, none matched) | A method whose rows are all zone rows keeps its flat price abroad; backend test and a browser check (a US cart still gets Standard, flat) |
| H4 | Low | The admin service's courier CSV wrote the BOM as an invisible character in the source (lint `no-irregular-whitespace`) | Written as `'﻿'` |
| H5 | Test | The orders suite clicked "Invoice" after "Mark as delivered", but delivering a cash on delivery order now invoices it, so the button goes away (and for a moment the page still showed it) | The suite asks the server for the order's state and invoices by hand only when it isn't paid yet |
| H6 | Test | The Bangla suite expected `01712 345678` to be refused for a Bangladesh address; phase 14 accepts it by design | The refusal is checked with a number that isn't a Bangladesh mobile; the local form is now checked to be saved as `+8801712345678` |
| H7 | Test | "The order has left the confirmation queue" was checked before the queue refreshed | The check waits for the card to go (up to 10 s) |
| H8 | Test | On the production build, the Bangla home check read product prices before the products were fetched again in Bangla (language-aware cache from G2) | The check waits for the product cards |

Checks: backend 550 feature tests (Pint clean); frontend 817 unit tests; admin 207; browser checks 1,755 on the dev server and 1,748 on the production build (full runs, plus the orders, Bangla and delivery suites rerun alone after the test fixes above), all passing (new `delivery.mjs`: 175). Not automated in the browser: a real SSLCommerz advance payment (stand-in only), printing packing slips on a real printer, importing the courier CSV into a courier's own system (column presets per courier are not claimed), and how dompdf draws Bangla conjuncts on packing slips (the known limit from phase 13). The Bangla thana names still need a native speaker's review.

## Home page: single banner or slider, and Bangla demo content — 2026-11-24

Asked by the user. Built by three agents in parallel (backend; admin with its sign-in service routes; storefront) against [backend/HOME_SLIDER_CONTRACT.md](backend/HOME_SLIDER_CONTRACT.md), then verified with the new `slider.mjs` browser suite (41 checks). Checks: the admin chooses "Single banner" or "Slider" (both kept), up to 8 slides with English and Bangla texts, colour, image, two buttons, active, order, autoplay and seconds per slide; the store's carousel follows the WAI-ARIA pattern (labels, Previous / Next, dots with `aria-current`, Pause / Play, arrow keys, swipe, hidden slides inert, no autoplay with reduced motion, no layout shift); slider mode needs an active slide and the public API falls back to the banner otherwise. Bangla drafts for the demo home texts, slides, and the 24 category names are filled only where the Bangla is empty and the English is still the demo text (listed in [I18N.md](I18N.md) for review).

| # | Severity | Problem | Fix |
|---|---|---|---|
| S1 | Medium | The home page save replaced everything: a save that left out the slider keys (an older client, script, or the system suite's cleanup) reset them and deleted every slide — found by the full browser run, where the slider suite started with 0 slides | A save without `hero_mode`, `slides`, or `slider` keeps what is stored (backend test); the system suite puts every key back |
| S2 | Test | "Featured" (the carousel) also matched the home page's "Featured products" region | The suite matches the carousel's name exactly |

Checks: backend 561 feature tests (Pint clean); frontend 844 unit tests; admin 213; browser checks 1,796 on the dev server (full run, with the slider suite rerun alone after fixing S1: 41; the system suite rerun too: 40) and 1,789 on the production build (full run, all passing).

## Phase 16 (configurable products like Magento's product page) — 2026-11-24

Asked by the user. Built by three agents in parallel (backend; admin with its sign-in service routes; storefront) against [backend/PHASE16_CONTRACT.md](backend/PHASE16_CONTRACT.md), resumed once after a usage limit (no file had been touched), then verified with the new `configurable.mjs` browser suite (45 checks). Builds on phase 5's options and variants. Checks: option types (text buttons or colour swatches, one colour option per product, `#RRGGBB` required), photos per colour, language-independent `code`s for options and values, `price_range` and colour `swatches` on every product list (query count independent of the number of products); the product page with nothing pre-selected, "From" prices, "Please select Size." with focus, "Color: Blue", price / stock / SKU / photo following the choice, sold-out values crossed and named "(sold out)", shareable links that work in both languages; cards with colour dots and "Choose options"; the admin's option type, colour picker, and "Shown for" per image; six demo products made configurable without touching staff products. Products without options are unchanged.

| # | Severity | Problem | Fix |
|---|---|---|---|
| C1 | Low | The first storefront build wrote the choice into the link with the shown (translated) names, so a link copied on a Bangla page didn't select anything in English | The API gives each option and value a code from its English name; links use the codes in both languages, and old name-based links are still read |
| C2 | Test | The storefront and accounts suites added the iPhone 13 Pro straight to the cart; it is now a configurable demo product that needs a choice first | They use a simple product (iPhone X); the configurable page is still checked by axe, and `configurable.mjs` covers choosing |
| C3 | Test | The catalog suite expected Add to cart to be disabled before a choice; like Magento it now stays enabled and asks for each missing option | The suite checks the "Please select Size." / "Please select Color." messages |
| C4 | Test | The marketing suite's cleanup read every page of unread admin notifications before the run but only the first 50 after it; once earlier runs had left 52 unread, it reported a notification "left" | It reads every page both times |
| C5 | Test | On the production build the payments suite's "guest card payment" part timed out loading a page twice (once in the full run, once alone), then passed 83/83 on the next run with no change; it uses no configurable product | Not changed; watched in the next runs |

Checks: backend 568 feature tests (Pint clean); frontend 871 unit tests; admin 222; browser checks 1,841 on the dev server (full run, with the storefront, accounts, and catalog suites rerun alone after C2/C3: 55, 19, 116) and 1,834 on the production build (full run, with the marketing and payments suites rerun alone: 187, 83). Not automated in the browser: hovering a colour dot to change a card's photo (pointer only), uploading a new photo and assigning it (the suite assigns an existing one), and a staff colour option with no swatches yet (refused by design until colours are set).

### Phase 16 follow-up: choices for every fitting demo product — 2026-11-24

Asked by the user ("many products have no variation; it should be sizes and colors"). Category rules in `ConfigurableDemoSeeder` give every other imported demo product choices: shirts, tops, dresses, and shoes Color × Size; phones and tablets Storage × Color; laptops RAM × Storage; watches, sunglasses, and bags Color (67 configurable products). Only imported demo products are changed (their DummyJSON SKU ends with their own id), never staff products; four products the browser suites buy as simple items stay simple; the demo photos stay shared (they are other angles, not colours). Backend test for the rules (569 feature tests).

| # | Severity | Problem | Fix |
|---|---|---|---|
| C6 | Test | The system suite edits the single banner's "Headline"; with the store set to the slider (as the user chose) the hero form is hidden and the suite stopped | It switches to the single banner through the API first; the home content is put back at the end as before |

Checks: browser checks 1,841 on the dev server (full run, with the system suite rerun alone after C6: 40). Not rerun on the production build: no storefront code changed since its last full run.

## Storefront redesign: indigo + coral, bold and colourful — 2026-11-25

Asked by the store owner ("eye-catching and modern, and update the theme colour"; chose Indigo + coral and a bold, colourful style). The lead set the theme tokens; two agents built the shell and components and the home page in parallel against [STOREFRONT_REDESIGN.md](STOREFRONT_REDESIGN.md) (stopped once at the owner's request and resumed the next day; every touched file was checked for half-finished edits). Checks: every colour pair that carries text measured (white on indigo 7.9:1, white on coral-strong 5.1:1, ink on bright coral 5.7:1; white on bright coral 2.8:1 is never used); no hard-coded colours outside print styles; screenshots at 1440px and 390px (no sideways scroll, no page errors); English and Bangla; reduced motion. Storefront only, plus the admin's colour labels.

| # | Severity | Problem | Fix |
|---|---|---|---|
| R1 | Medium | The newsletter block promised "Get 10% off your first order" (old template text); subscribing gives no coupon | Honest title: "Be first to hear about deals" / "অফারের খবর সবার আগে পান" |
| R2 | Low | Today's deals said "Up to 19% off" while the cards showed "-20%": the band rounded down, the cards to the nearest | The band rounds like the cards (unit test) |
| R3 | Low | The admin still named the banner/slide colours Navy / Emerald / Amber / Rose, which now show as ink, indigo, coral, violet | Labels Ink / Indigo / Coral / Violet; the stored keys are unchanged so old content keeps working |
| R4 | Low | Carousel cards were squeezed into narrow columns at desktop width (found by builder B's screenshot) | Fixed card widths in the carousel |
| R5 | Test | The motion suite clicked "Close", which now also matched the announcement bar's "Close announcement" | It clicks the cart dialog's own Close |

No countdown in Today's deals: the API exposes no end date for price rules, and a countdown without one would be false urgency. Not done in this round: the list API sends no extra images, so the cards' second photo on hover shows only where product data includes images (demo mode); brand logos (the API has none, so brands are name chips).

Checks: frontend 898 unit tests; admin 222; browser checks 1,841 on the dev server (full run, with the motion suite rerun alone after R5: 7) and 1,834 on the production build (full run, all passing).

## Phase 17 (marketplace-style storefront, Fastkart-like layout) — 2026-11-25

Asked by the store owner ("I need this type of frontend design": Pixelstrap's Fastkart, a commercial ThemeForest template). Built as an **original** design in that style — no code, CSS, images, icons or text taken from the template — by four agents in parallel (backend; admin with its sign-in service routes; storefront shell; storefront home) against [backend/PHASE17_CONTRACT.md](backend/PHASE17_CONTRACT.md), then verified with the new `marketplace.mjs` browser suite (62 checks). Indigo + coral theme kept. Honest data throughout: "Best selling" only from real orders (`units_sold`, `meta.has_sales`), a coupon only while active, no invented "sold recently" or countdowns.

| # | Severity | Problem | Fix |
|---|---|---|---|
| M1 | Medium | "Best selling" stayed hidden although the store had sales: the storefront's proxy whitelists list `meta` keys and dropped the new `has_sales` | `has_sales` passed through (proxy test) |
| M2 | Medium | With no recent sales, `sort=best_selling` falls back to rating order, which the home page would have labelled "Best selling" | The API adds `units_sold` and `meta.has_sales` (only on that sort); the home tab and list show only products that really sold, and hide otherwise |
| M3 | Medium | On tablets (768–1023px) the new header spilled sideways (up to 170px): the search with its "Search in" select couldn't shrink | The search can shrink, tighter gaps below 1024px, the category select from 1024px; checked at 8 widths on 4 pages |
| M4 | Low | An unchanged promo coupon that had expired would have blocked every home page save (the admin always sends the strip back) | Only a new or changed code is checked; an expired one just stops showing |
| M5 | Low | Dialogs opened from the header (Deliver to) put a `<header>` landmark inside the site's banner; "Cash on delivery is available here." was 4.42:1 on the lavender tint | Dialog title and button rows are plain containers; the success green is darker (6.3:1 on the tint, 7.1:1 on white) |
| M6 | Low | The footer's store address had no data: `/store` didn't send Settings → General's address | `/store` sends `address` (test) |
| M7 | Low | The category icon row wrapped 10 + 2 on desktop | Even rows: 12 across from 1200px, 6 per row below |
| M8 | Test | Three suites found the search box as "the first combobox"; the top bar's currency select and the "Search in" select could come first | They name it ("Search products") |
| M9 | Test | Under a full run the loyalty suite's "Recently viewed" waited 15 s for the busier home page; the mega menu's keyboard check read the focus a frame before it moved; the marketing suite's saved-cart page once took over 15 s to load (production build) | 30 s waits for those rows; the check waits for focus; marketing passed 187/187 alone with no change |

Not a bug, checked: the dev server makes each home page request twice (React's development double-run); the production build makes 9 requests and is idle in about 1.7 s.

Checks: backend 587 feature tests (Pint clean); frontend 971 unit tests; admin 228; browser checks 1,903 on the dev server (full run, with the loyalty suite rerun alone after M9: 130) and 1,896 on the production build (full run, with the marketplace and marketing suites rerun alone: 62, 187). Not automated in the browser: the sticky header's compact state on scroll, hovering a card for its second photo, and a real phone's clipboard permission prompt.

## Storefront restyle: follow the reference design (flat, light, steel blue) — 2026-11-25

Asked by the store owner ("update design and theme colors, follow my reference link": Fastkart demo 9, `theme-color-5`). The look was matched (steel blue `#417394`, coral-red accents, `#f8f8f8` tiles, charcoal footer, Public Sans, flat cards and buttons, small radii) with **our own code, CSS, icons, images and texts**; only colour values and the free Google Font were taken. The lead set the theme; two agents restyled the shell and pages and the home page in parallel against [STOREFRONT_FASTKART_STYLE.md](STOREFRONT_FASTKART_STYLE.md). Checks: every text colour pair measured, screenshots side by side with the reference at 1440px and 390px, no sideways scroll at 390/600/768/820/900/1024/1280/1440px, axe on the main pages, English and Bangla. All features from phases 1–17 kept.

| # | Severity | Problem | Fix |
|---|---|---|---|
| F1 | Medium | The reference's coral-red `#ff4f4f` with white text is 3.2:1 (fails WCAG AA) | `#ff4f4f` only for shapes, badges' backgrounds with large text and icons; sale prices and white-on-red buttons use `#d32f2f` (4.98:1) |
| F2 | Low | Light banner tones with coloured text: the reference's pale blue and beige needed darker words | Tone text `#2c5068` on blue grey and `#b3261e` on pink (7.3:1 and 5.6:1); the admin's tone labels renamed Blue grey / Grey / Beige / Pink (stored keys unchanged) |
| F3 | Low | The footer's store email broke in the middle of a word at 1280px | The store column has a minimum width and long addresses wrap at sensible points |
| F4 | Low | A recolouring script emptied the favicon (opened for writing before reading) | Restored from git and recoloured; every touched file checked for 0 bytes |
| F5 | Test | The slider suite picked the slide colour by its old label "Coral" | It picks "Beige" |
| F6 | Test | The marketing suite's cart-rules page once took over 15 s to load in the full dev run | Passed 187/187 alone with no change |
| F7 | Test | The security suite checked that the old web font (Inter) loads under the content security policy | It checks Public Sans |
| F8 | Test | The slider suite's Bangla accessibility check sometimes ran during the 400 ms slide cross-fade, measuring half-transparent text as low contrast (production build, 1 run in 4) | It waits for the fade to finish; every slide checked in both languages has no contrast issue |
| F9 | Test | Under the full production run, two pages took over 15–30 s to load (extras: cookie consent; marketplace: phone footer, once the admin's home page) | Passed alone with no change (extras 164/164, marketplace 62/62); the test data was checked clean afterwards |

Intentional differences from the reference: search and "All categories" sit on a second header row (our search has a category picker and suggestions); no countdowns, "sold" bars or invented ratings (honest data); our own line icons and photos.

Checks: frontend 971 unit tests; admin 228; browser checks 1,889 on the dev server (full run, with the marketing suite rerun alone after F6: 187) and 1,877 of 1,881 on the production build (full run; the four failures are F7–F9, and the security, slider, extras and marketplace suites then passed alone: 20, 41, 164, 62).

## Phase 18 (courier integration: Steadfast and Pathao) — 2026-11-26

Asked by the store owner after the Bangladesh delivery work. Built by three agents in parallel (backend; admin app with its sign-in service routes; storefront) against [backend/PHASE18_CONTRACT.md](backend/PHASE18_CONTRACT.md), then a fourth wrote the new `courier.mjs` browser suite (113 checks) with local stand-in Steadfast and Pathao servers and a second API in taka pointed at them. **No real courier was called**; the couriers' wire formats come from their published merchant APIs and community SDKs, and must be checked with sandbox credentials before going live (launch step in [BANGLADESH.md](BANGLADESH.md)). The lead reviewed the webhooks (secret compared with `hash_equals`, 401 / 404 / no-op answers) and the delivered-parcel logic (cash never more than due, never backwards, cancelled orders untouched).

| # | Severity | Problem | Fix |
|---|---|---|---|
| D1 | Medium | The booking dialog showed the customer's account name, but the courier is sent the shipping address's name (they can differ: a gift, a relative) — found by the browser suite | The dialog shows the shipping name (account name only as a fallback) |
| D2 | Medium | With `BUYNEST_REQUIRE_BFF_KEY=true` (production) the API would have refused the couriers' webhooks: they post straight to the API, without the storefront's key | The two webhook paths skip the key check; the courier's shared secret is the proof |
| D3 | Low | Steadfast's `tracking_update` webhooks carry a message but no status: treated as a status they would have reset the parcel | They add a timeline entry only when the message is new; the status stays |
| D4 | Low | A late or repeated courier message could have moved a delivered / returned / cancelled parcel back to "on the way" | Finished parcels stay finished (only the last-checked time changes) |
| D5 | Low | A courier booking can take longer than the sign-in service's usual 15 s wait, which would report a booking that went through as failed | Booking and "Refresh status" wait 60 s, bulk booking 300 s |
| D6 | Test | The orders grid's new filter, if named "Delivery status", would also match the admin suite's `getByLabel('Status')` | Named "Delivery progress" |
| D7 | Test | The marketing suite gave page loads the same 15 s as clicks; under a full dev run three different page loads in it (cart rules, saved cart, SEO and search) each once took longer | Page loads in that suite wait up to 45 s; other waits stay 15 s |
| D8 | Medium | The "To confirm" queue still listed cash-on-delivery orders that had been shipped anyway (with a reason) or delivered, so staff could call about parcels already on their way; old test orders piled up and pushed real ones to page 2 (found by the delivery suite on the production build) | The queue shows only orders that haven't shipped yet (feature test) |

Not automated: a real courier account (sandbox or live), the courier's own tracking pages (links only), and a real webhook from the internet reaching a local machine.

Checks: backend 643 feature tests (Pint clean; the D8 check added to an existing test); frontend 1,011 unit tests; admin 246; browser checks 2,013 of 2,014 on the dev server (full run; the marketing suite then passed alone after D7: 187) and 2,008 of 2,009 on the production build (full run; the one failure is D8, and the delivery suite then passed alone after the fix: 175).

## Phase 19 (welcome coupon) — 2026-11-27

Asked by the store owner ("start next steps", after the welcome coupon was recommended). Built by three agents in parallel (backend; admin app with its sign-in service routes; storefront) against [backend/PHASE19_CONTRACT.md](backend/PHASE19_CONTRACT.md); all three were cut off once by a usage limit and resumed the next day with their context (no file was left empty). A fourth agent wrote the `welcome.mjs` browser suite (72 checks). **Off by default**: with the setting off every page and test behaves as before. The lead reviewed the grant (one per email through a unique table, only confirmed addresses, mail after commit, failures never block sign-up or the newsletter) and the coupon checks (personal email, first order only, re-checked at checkout).

| # | Severity | Problem | Fix |
|---|---|---|---|
| W1 | Test | The extras suite read a search term's hit count twice (once to judge, once to print); under the full production run the first read came a moment before the hit was saved ("records … 1 hit" reported as a failure) | It waits up to 5 s for the hit and judges and prints the same reading |
| W2 | Low | The admin preview showed a fixed discount as "৳100.00 off" while the store shows "৳100 off" | Whole amounts without ".00" in the preview, like the store |
| W3 | Test | Under the full production run the accounts suite's first page load (home, waiting for a quiet network) took over 30 s once, and the extras suite's analytics `begin_checkout` event was missed once | Both passed alone with no change (accounts 19/19, extras 164/164) |

Not automated: real email delivery (the dev mailbox is used), and a shopper switching language between subscribing and confirming (the email follows the customer's or the request's language). The Bangla wording of the new email and messages should be reviewed by a native speaker.

Checks: backend 659 feature tests (Pint clean); frontend 1,062 unit tests; admin 258; browser checks 2,088 of 2,088 on the dev server (full run) and 2,061 of 2,063 on the production build (full run; the accounts suite did not finish once, W3; accounts, then extras after W1, passed alone: 19, 164).

## Phase 20 (SMS notifications for orders) — 2026-11-27

Asked by the store owner after SMS order texts were recommended. Built by three agents in parallel (backend; admin app with its sign-in service routes; storefront) against [backend/PHASE20_CONTRACT.md](backend/PHASE20_CONTRACT.md); a fourth wrote the `sms.mjs` browser suite (95 checks) on the log driver and the dev SMS inbox. **Off by default; no real SMS** until a provider account is added; the SSL Wireless and BulkSMSBD wire formats are unverified (a test SMS is a launch step in [BANGLADESH.md](BANGLADESH.md)). The lead reviewed the one-tap link (hashed 256-bit token, GET never changes anything, POST locks the order, single-purpose, 72 h, throttled, cancel follows the staff rules so a shipped or invoiced order can't be cancelled).

| # | Severity | Problem | Fix |
|---|---|---|---|
| S1 | Medium | **Pre-existing, found by the full run:** after an admin signs in, the app loads the role's permissions from `/me`; when that request failed or was slow it kept the sign-in answer, which has no permission list, and "no list" means "show everything" (meant for demo accounts). Under load a Viewer briefly saw Create order and the Invoice / Ship / Cancel bulk actions (the API still refused them: 403) | `/me` is tried three times; if it still fails the app **fails closed** with an empty permission list (unit tests) |
| S2 | Test | The courier suite starts its own storefront dev server; under the full run its first page compile took over 15 s | Page loads in that suite wait up to 45 s (as the marketing suite since D7) |
| S3 | Test | The SMS suite expected the confirmation link on the address under test; the link uses the API's configured storefront address, which is the dev server's even while the production build is tested on another port | It checks for a `/c/` link on any storefront address and opens the token on the address under test |

Known and accepted: the one-tap link is visible in the SMS log to staff who can view orders (they can already confirm orders themselves); a "review" (risky) SSLCommerz payment gets no "order received" text when staff later invoice it by hand; Bangla default texts need the owner's review (the confirmation text with its link is close to 2 SMS parts).

Checks: backend 682 feature tests (Pint clean); frontend 1,118 unit tests; admin 287; browser checks 2,124 of 2,129 on the dev server (full run; customers and courier then passed alone: 161, 113; S1 and S2 fixed) and 2,175 of 2,176 on the production build (full run; the one failure is S3, then the SMS suite passed on both: 95, 95).

## Fresh-clone setup (README B24) — 2026-11-28

Asked by the store owner ("is this project run any one clone from my git?"). `./setup.sh` was tried on a fresh clone with the computer's old default PHP 8.1 and Node 20 (it links PHP 8.5 and Node 22 in `.tools/bin`), run twice (safe to repeat) and with a too-long folder path (a clear error). Then every check ran on the new computer, where the first full browser runs failed in many places. Each failure was rerun alone and traced to its cause before anything was changed.

| # | Severity | Problem | Fix |
|---|---|---|---|
| FC1 | Medium | **The fresh-clone setup made the browser suites fail.** Phase 5 (S6) relaxed the request limits only in the old computer's `backend/.env`, which git never had; `setup.sh` copied the production limits from `.env.example`. The admin's requests then got 429 "Too Many Attempts" (240 a minute per staff account): a shipment search showed no rows, a new customer's page never loaded, and the admin showed neither its pages nor the sign-in page (this looked like "a deactivated admin is not signed out", but the API refuses a deactivated admin on every request, as `AdminUsersTest` proves). Ten sign-ins a minute per email stopped the sessions suite, which signs Ava in 17 times | `setup.sh` writes development limits into a **new** `backend/.env` (sign-ins 300 / 100 per email, orders 100, reviews 100 per hour, API 2,000 a minute); `.env.example` keeps the production values and explains this; backend tests pin the production values in `phpunit.xml`. README tells owners of an older `.env` which five values to set |
| FC2 | Test | After the owner changed `backend/.env`, the failures went on: `dev.sh` starts the API so that it reads `.env` only once, so it kept the old limits (tinker showed the new ones, because it reads the file again) | Restarted `./dev.sh`; the live limit was confirmed in the `X-RateLimit-Limit` response header. README and CLAUDE.md say to restart after changing `.env` |
| FC3 | Test | The run stopped the night before had left its test data behind: 8 test products, 2 test categories, a throwaway customer with an order, and reward points switched on. The storefront suite then counted 201 products instead of 194, and the loyalty suite found reward points on before it began | Removed the way the suites' own clean-up does (through the admin API: products parked as drafts and deleted, the order moved on to Delivered, the customer deleted, reward points off). CLAUDE.md now says to check for leftovers after an interrupted run |
| FC4 | Test | The sessions suite signs the same demo account in 17 times; even with relaxed limits a strict computer refuses some | The shared sign-in helper waits out the minute when the API answers 429 and tries again (at most twice); the cart helper waits as long as `Retry-After` says. Any other sign-in failure still fails |
| FC5 | Test | Under the full run, axe reported low contrast on the Bangla one-tap order page: it checked the two language buttons halfway through their 150 ms colour fade, when the text was half transparent | Every accessibility check (all 23 suites) now waits up to 2 s for running fades and slides to finish |
| FC6 | Test | "A deactivated admin is signed out" allowed the screen 5 s, a third of the suite's usual wait | 15 s, like the rest of the suite |
| FC7 | Low | Once, in the full dev run, the home page scrolled 170 px sideways at 390 px wide in the marketing suite. It did not happen again: the home page measured 0 px over 4 s in three fresh loads, marketing passed alone (187/187) and in the production run | Not reproduced; the check now names the element that sticks out (`overflowCulprits`), so a repeat explains itself |

Also in this step: the admin's package list (`npm ci` works again) and short money amounts in the admin (`৳12K`, not `৳12.0K`, on newer browsers). The customers and welcome suites now print what they saw when a check fails (rows found; settings before and after).

Checks: backend 682 feature tests (Pint clean); frontend 1,123 unit tests; admin 287; browser checks on the dev server: first full run 2,095 passed and 11 failed, with the sessions and admin suites not finished (FC1, FC3, FC5); second 2,128 passed and 3 failed, the admin suite not finished (FC2 and FC7; system and admin then passed alone, 40 and 53); production build: 2,176 of 2,176 (full run, every suite passed).

## Phase 21 (sales and cash reports) — 2026-11-28

Asked by the store owner ("you should start next phase", approving the proposed answers to Q1–Q5). Three read-only agents first surveyed the backend, the admin with its sign-in service, and the browser suites; their briefs found 12 places where the draft contract didn't match the code, fixed in [backend/PHASE21_CONTRACT.md](backend/PHASE21_CONTRACT.md) before building. Then a backend agent and an admin agent built in parallel (both cut off once by an internet drop and resumed from the files' real state; no file was left empty), and a third agent wrote the `reports.mjs` browser suite. **Read-only reports:** nothing to switch on; with the time zone left at UTC every older report answer is unchanged except the added fields.

| # | Severity | Problem | Fix |
|---|---|---|---|
| R1 | Medium | **Contract:** a cash collection recorded by staff always counted as "collected by staff", so a courier booked by hand (RedX, Paperfly, Sundarban) never had collected cash, and recording its payment showed "Paid more than recorded" (found by the backend agent) | Cash recorded by staff on an order whose latest shipment is a courier's counts for that courier (its rider collected it); "staff" only for the shop's own delivery. The backfill applies the same rule (4 dev invoices moved from staff to a courier) |
| R2 | Medium | A parcel that came back (returned, or cancelled by the courier) stayed in "Still to collect" for good, inflating the shop's outstanding cash (found by the browser suite) | Left out of Still to collect and its total; counted as returned or cancelled |
| R3 | Medium | A courier whose fees (returned parcels included) were more than the cash it collected showed "Paid more than recorded — check the payments" although no payment was recorded | A new note `fees_more_than_collected`: the card says "You owe Pathao ৳40" and why; "Paid more than recorded" only when payments are recorded |
| R4 | Low | axe `landmark-unique` on Money in and Cash on delivery: each table's scroll area repeated its section's name, so screen readers listed the same area twice (found by the browser suite) | Each table area has its own name ("Amounts by channel", "Orders still to collect", …) |
| R5 | Low | The admin learned the store time zone only from a loaded report: before that it assumed UTC, so between midnight and 6 a.m. in Dhaka the payment dialog could refuse today's date | The public store info (`GET /api/v1/store`) names the time zone; every admin page reads it; saving a new zone refreshes it |
| R6 | Test | The 409 duplicate warning's `duplicate_of` was dropped twice on the way to the screen (the sign-in service's `failed()` and the admin's `ApiError`), found by the survey | Kept as `duplicateOf` in both, with proxy tests |
| R7 | Test | Admin unit tests failed at random on a busy computer (2–11 per run: 1 s waits for the screen, 5 s per test); some LiveData checks also read "the newest request", which was sometimes the layout's store-info or notifications request | As in the storefront: 5 s waits, 15 s per test, half the cores; the LiveData checks wait for the newest request *to the list being filtered*. 311/311 three runs in a row |
| R8 | Test | The system suite's sidebar check looked for a link named "Products" without `exact`, so it also matched the new "Sales and products" and stopped (strict mode) | Sidebar links are matched by their exact names (the new Reports links included) |
| R9 | Test | In the first full dev run the orders suite stopped once: a product page's on-demand code failed to load ("Couldn't load preload assets" in the dev server's log at that minute), after an hour of edits and dev-server restarts while the phase was built | Development server only (the production build serves fixed files); orders then passed alone, 41/41 |

Not automated: real courier payout statements (no courier API is asked; a later step after sandbox checks with the owner's accounts); "Fees not reported" on a real database (unit-tested; the dev data has fees from every courier). The admin pages are English only, as before.

Checks: backend 696 feature tests (Pint clean); frontend 1,143 unit tests (20 new proxy tests); admin 311 (24 new); browser checks on the dev server: 2,215 passed and 2 failed, with the orders and system suites not finished (R8, R9; both then passed alone, 41 and 40); on the production build 2,289 of 2,289 (full run, every suite passed; new `reports` suite: 113 checks, its own API with a Steadfast and a Pathao stand-in).

## Phase 22 (product reviews with photos) — 2026-11-28

Started on the owner's "you should start next steps": the first idea on the list that needs none of the owner's outside accounts. Contract with proposed answers to Q1–Q5 (3 photos, reviews with photos always wait for approval, off by default, photos always cleaned, no extra points): [backend/PHASE22_CONTRACT.md](backend/PHASE22_CONTRACT.md). Four agents built in parallel: backend, storefront with its sign-in service, admin with its routes, and the `review-photos` browser suite. All four stopped once on the account's 5-hour usage limit and carried on after it reset; their files were checked first (no empty or half-written files). **Off by default** (`review_photos_enabled`): every older suite ran unchanged.

| # | Severity | Problem | Fix |
|---|---|---|---|
| P1 | High | The store's photo service (`/media/…`) fetched files without the sign-in service's shared key. Review photos come from an API route, so on a server that requires the key (production) every review photo would have been refused and shown as missing (found by the storefront agent) | The media service sends the key like every other call to the API, with a test |
| P2 | Medium | Re-running `buynest:import-catalog` ("safe to run again") deleted every review without a customer to refresh the demo reviews, but a customer who erases their account keeps their reviews with no customer, so real reviews were lost and ratings changed (older bug, found by the backend agent) | Imported reviews are marked (`imported`, 582 demo reviews marked on the dev database by the migration; reviews written in the shop stay unmarked) and only they are replaced; tested |
| P3 | Medium | Phone photos carry hidden data, often the exact GPS spot where they were taken | Cleaned twice: the browser redraws each photo (at most 1600 px), and the server re-encodes it and strips any metadata left (pure-PHP fallback when GD is missing). The browser suite checks that the served bytes contain neither `Exif` nor `GPS` |
| P4 | Low | The development API (`php artisan serve`) used the computer's PHP defaults, 2 MB per file and 8 MB per request, while the live server allows 5 MB and 60 MB: in development a photo between 2 and 5 MB was refused as "at most 5 MB" | `./dev.sh` adds `backend/docker/php-dev/uploads.ini` (production upload sizes) through `PHP_INI_SCAN_DIR` |
| P5 | Low | A photo error from the server would also have shown as the general form error above the button, so twice | Photo errors are shown only under the photo field |
| P6 | Test | The suite's Bangla check put the language cookie after Ava had signed in, but the store lets the account's language win (phase 13, by design: she signed in on an English page), so the page stayed English | The suite switches to বাংলা with the header switch, as a shopper would; clean-up resets Ava's language |
| P7 | Test | The admin "With photos" check read the list while the previous answer was still on screen | It waits until the review without photos has left the list |
| P8 | Test | One admin unit test (forced two-step setup) timed out once while the backend tests ran at the same time | Passed alone and in a full rerun on a quiet computer (319/319); no change |

Known limits (documented): Vercel and Netlify functions take at most about 4.5 MB and 6 MB per request, so on those hosts three large photos may be too much together (the browser's shrinking usually keeps them well under); a customer's "download my data" file does not include their review photos yet; iPhone HEIC photos are converted to JPEG by the phone's browser when chosen in the form (not tested on a real iPhone).

Checks: backend 716 feature and unit tests (22 new, and the catalog import test now also proves P2; Pint clean); frontend 1,199 unit tests (was 1,143: storefront, proxy and admin-proxy tests); admin 319 (8 new); browser checks on the dev server 2,372 of 2,372 (29 suites, new `review-photos` suite: 76 checks); on the production build 2,365 of 2,365 (28 suites; every suite passed).

## Phase 23 (My reviews) — 2026-11-28

Chosen by the owner from the next-step options ("My reviews page"); contract with proposed answers to Q1–Q4 (customers may delete, no editing, rejected shown as "Not published", hidden photos shown to the author only): [backend/PHASE23_CONTRACT.md](backend/PHASE23_CONTRACT.md). Three agents built in parallel: backend, storefront with its sign-in service, and the `my-reviews` browser suite. No admin change. Nothing to switch on: the page is in every BuyNest account; with no reviews it shows an empty state.

| # | Severity | Problem | Fix |
|---|---|---|---|
| M1 | Medium | Before this phase a customer couldn't see a review that wasn't published, delete it, or remove a photo; the product page offered a form that the server would then refuse ("already reviewed") | My reviews page; the product page says "You've already reviewed this product" with a link |
| M2 | Low | The translated sentence "See it in My reviews" used `<link>` as the tag for its link, and `<link>` is an empty HTML element, so the link had no text and the words sat outside it (found by the storefront agent) | Renamed to `<page>`; a unit test checks the link's name |
| M3 | Low | After deleting a review, "Show more reviews" would have skipped one: the server's pages move up by one | Every page already shown is fetched again after a delete; unit-tested |
| M4 | Test | A cart unit test (signing in merges the saved cart) failed now and then: it read the browser's storage the moment the screen showed the merged cart, a moment before it was written (older test, no cart code changed) | It waits for the saved cart itself; 1,231/1,231 on the rerun |
| M5 | Test | The account deletion unit test timed out once while the whole storefront set ran beside the admin set | Passed alone and in the full rerun; no change |
| M6 | Test | The catalog suite tested "a second review is refused" by filling in the form again; the product page now shows "You've already reviewed this product" instead of a form, so the suite stopped (expected change, found by the full dev run) | It checks the note, and sends the second review straight to the sign-in service: 422 `already_reviewed`; 117/117 alone |
| M7 | Test | The review-photos suite (phase 22) checked the Bangla photo field after Ava had already reviewed the product, so there was no form any more (same expected change) | The Bangla photo field is checked before her review; the later Bangla step checks the "already reviewed" note in Bangla; 77/77 alone |
| M8 | High | **Checkout could fail at random for a signed-in customer (older bug, phase 7).** Each price check saves the customer's cart; when two checks came at the same moment (checkout asks again when the address or payment changes) and the customer had no saved cart yet, both tried to add one, the second hit the "one cart per customer" rule and answered 500, and the order couldn't be placed. Found because the sms suite (full dev run: order not confirmed within 45 s) and then the extras suite (production run: a gift-card order within 30 s) stopped this way; the API log had the same error at exactly those minutes, and 97 times in all on this computer | The losing request now updates the cart the other one just added. A new backend test makes "the other request" add the row first: without the fix it answers 500 with the same error, with it 200 and one cart. After the fix: sms 95/95 and extras 164/164 (production build) and no new error in the log |

Known limits: a photo shown on My reviews can't renew an expired sign-in by itself (the list request just before normally has), so after a very long idle time a thumbnail may show "couldn't be loaded" until the page is reloaded; "Download my data" is limited to 3 per hour per customer and the browser suite uses one of Ava's per run (a dev run, a production run and one rerun fit in an hour); "Show more reviews" is covered by unit tests only (the browser suite would need 11 reviews by Ava).

Checks: backend 730 (14 new: 13 for My reviews, 1 for M8; Pint clean); frontend 1,231 unit tests (32 new: 17 proxy, 15 page and form); admin 319 (unchanged); browser checks on the dev server: 2,369 passed and 6 failed (M6, M7, M8; the three suites then passed alone: catalog 117, review-photos 77, sms 95; new `my-reviews` suite 88/88); on the production build 2,406 passed and 4 failed, all in extras' gift-card order (M8, before the fix), then extras alone 164/164 with the fix: with the other 28 suites (2,291), 2,455 checks passed on the production build.

Other "add it if it's missing" spots were checked: staff brands, preferences and email templates, the newsletter, and the catalog import are single actions, not repeated at the same moment by shoppers; left as they are.

## Known limits (by design, documented)

- In the DummyJSON demo mode, orders, payment, and stock are still simulated in the browser.
- With `VITE_API_PROVIDER=laravel` and `VITE_ACCOUNTS_BACKEND=laravel` accounts, catalog, and orders are real. Card payments go through Stripe once `STRIPE_SECRET_KEY` is set (until then card orders wait as "Awaiting payment" for an admin to invoice them); PayPal orders still wait for an admin, and their refunds record money the shop returns by hand. Tax is 0 until phase 4.
- Customers can't change their own email in the store yet (an admin can, and the customer then confirms it by code at the next sign-in).
- The Vercel and Netlify function wrappers (sign-in and admin API) are verified locally only; confirm sign-in and `/admin/` once after the first deploy (see `docs/DEPLOYMENT.md`).
- The local database keeps a few records from the agents' and browser checks' verification: test orders and invoices, deactivated test admins (for example "Verify Viewer" and "Smoke Sales"), and disabled test coupons.
- Products deleted in the admin are soft-deleted (kept for past orders); the browser checks leave their own deleted Draft test products behind in the local database (the catalog suite parks them in Home decoration before deleting them, because a deleted product still keeps its category).

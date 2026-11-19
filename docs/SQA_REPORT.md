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

## Known limits (by design, documented)

- In the DummyJSON demo mode, orders, payment, and stock are still simulated in the browser.
- With `VITE_API_PROVIDER=laravel` and `VITE_ACCOUNTS_BACKEND=laravel` accounts, catalog, and orders are real. Card payments go through Stripe once `STRIPE_SECRET_KEY` is set (until then card orders wait as "Awaiting payment" for an admin to invoice them); PayPal orders still wait for an admin, and their refunds record money the shop returns by hand. Tax is 0 until phase 4.
- Customers can't change their own email in the store yet (an admin can, and the customer then confirms it by code at the next sign-in).
- The Vercel and Netlify function wrappers (sign-in and admin API) are verified locally only; confirm sign-in and `/admin/` once after the first deploy (see `docs/DEPLOYMENT.md`).
- The local database keeps a few records from the agents' and browser checks' verification: test orders and invoices, deactivated test admins (for example "Verify Viewer" and "Smoke Sales"), and disabled test coupons.
- Products deleted in the admin are soft-deleted (kept for past orders); the browser checks leave their own deleted Draft test products behind in the local database (the catalog suite parks them in Home decoration before deleting them, because a deleted product still keeps its category).

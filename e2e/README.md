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
| `documents.mjs` | Coupons created in the admin and checked by the server (unknown, applies, used up), free shipping; invoice, shipment with a UPS tracking link (email and guest tracking page), partial and full refunds with restock until the order is Closed, the printable invoice, someone else's invoice refused, sales lists, a used coupon disabled instead of deleted |
| `system.mjs` | Roles: an Owner creates a Sales staff admin, whose menu, pages, and API calls are limited (403 `permission_denied`); audit log (never the password); a content page edit with a script, an event attribute, and a `javascript:` link (all removed, nothing runs in the store); the home page headline; settings that turn guest checkout off and add 10% tax; reports and CSV; phone layout; a deactivated admin signed out. Puts every change back |
| `catalog.mjs` | Phase 5 catalog management, on its own test category, products, and review only: a category tree (add, subcategory, edit, move up/down, deactivate/activate, delete refused while it holds products or subcategories); a Draft product with an uploaded PNG (a text file named `.jpg` refused), alt text, Size/Color options and generated variants with their own SKU, price, and stock; the store's category page, navigation, and product page (image from `/media/…`, option radios, sold-out combinations disabled, price per variant); two variants in the cart, checkout, confirmation, and account order with variant labels; variant stock down, then back up by a restocking credit memo; a review (verified purchase) approved in the admin; bulk disable/enable/price/stock on the grid; CSV export, a dry-run import with an error row, a clean import; a Viewer admin limited to reading; phone layout. Removes everything it made and puts the settings and stock back (orders stay) |
| `customers.mjs` | Phase 6 customers and sales, on its own test group, customers, and addresses: the store's address book (add, edit, defaults, delete) and checkout with saved addresses (default filled in, picker, "Save this address"); a 15% customer group in the cart, checkout, and order; the admin customer page (keyboard tabs, account, address, staff note), "Add customer" with the "Set your password" email and the code that lets them sign in, block/unblock, delete refused with an open order and allowed without orders, list filters and CSV export; Create order for a customer (product search, saved address, staff-only cash, live totals, Source "Admin"); bulk invoice (done and skipped) and ship, packing slips without prices, the Shipments list and detail; a return requested in the store, approved with a note, received with restock, refunded through "Refund this return" (stock back once) with its emails; Settings → Returns; a Viewer admin limited to reading; phone layout. Removes what it made and puts SHOPPER_2's group, the settings, and stock back (orders, returns, and credit memos stay) |
| `marketing.mjs` | Phase 7 marketing and system, on its own test category, product, group, rules, coupons, subscribers, and redirects: catalog price rules made in the admin (product picker, preview of affected products), the sale price and rule name on the product page, category listing, and search, a group-only rule applied in the group member's cart ("… price"); cart price rules: an automatic rule with a minimum and free shipping, a code for one category ("Spend $20.00 more"), buy 2 get 1, the labels and totals in the cart and checkout, the order's rules and per-line discounts, a partial refund of one line's share; the newsletter (footer form with the same answer for new and subscribed addresses, the emailed confirm link, admin subscribers, a campaign with live preview, test send, real send, `List-Unsubscribe` header, unsubscribe page, Account switch); the verification email template (preview, test, a real sign-up code, reset); SEO tags, meta title, `/sitemap.xml`, `/robots.txt`, a URL redirect and a search redirect, the search terms report; a saved cart restored once on another device and emptied from the mini cart; an abandoned cart (backdated) with Remind and the 72-hour limit; the dashboard blocks, a low-stock notification and the bell (mark read, mark all, Escape); grid columns and saved filters; a Marketing admin's pickers and refusals; phone layout. Removes what it made and puts the template, grid settings, notification reads, SHOPPER's newsletter setting, SHOPPER_2's group, carts, and stock back (orders, credit memos, the sent test campaign, and used coupons, disabled, stay) |
| `signup.mjs` | Sign-up with name, email, phone; the emailed 6-digit code (wrong and right); profile changes saved; duplicate email; unconfirmed sign-in; password reset by code; the admin sees the new customer; the test inbox |
| `security.mjs` | Tampered browser data, URL edge cases, Escape in the mobile search, checkout price re-check, coupon lock; on the production build, the Content-Security-Policy on every page of both apps |
| `motion.mjs` | Mini cart, mobile menu, and quick view animate smoothly (no jump back) |
| `admin.mjs` | Admin dashboard: separate admin sign-in and cookies, customers refused (sign-in and API), every admin page, demo edits, blocking and unblocking a real customer, phone layout, accessibility, admin and store sessions independent |
| `laravel.mjs` | The storefront on a mock Laravel API (`laravel-mock-server.mjs`) with only settings changed |

`catalog.mjs` writes two reviews per run as the demo customer, and the API allows 10 review attempts per customer per hour, so after about five runs in an hour the review checks fail with "Too Many Attempts." Wait, or reset that limit locally: `php artisan tinker --execute='RateLimiter::clear(md5("reviews"."customer:1"));'` in backend/ (1 = the demo customer's id).

`marketing.mjs` also needs `php` on the machine: it backdates its own abandoned cart (`php artisan tinker`), clears the sitemap cache so its new product is listed at once, and removes its subscribers, notifications, and grid settings that have no delete endpoint. It sends a real newsletter only when every subscribed address is one of its own test addresses (otherwise that check fails and the send is skipped), and reads the `List-Unsubscribe` header from the test inbox (`/dev/mailbox/latest` includes `headers`).

`admin.mjs` saves screenshots (`admin-overview-*.png`, not committed).

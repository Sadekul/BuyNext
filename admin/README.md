# BuyNest Admin

The shop staff's dashboard: a separate React app, served at **`/admin/`** on the
storefront's address. Admins have their **own accounts and their own sign-in**,
separate from customers.

| Page | What it does |
| --- | --- |
| Overview | Revenue, average order, units sold, products, low stock, customers, inventory value; products that need restocking; latest orders |
| Products | Search, category filter, sorting, pages; add, edit, and delete products (with server-side validation) |
| Orders | All orders with pages; order details with items, totals, and the customer |
| Customers | The real sign-ups (BuyNest accounts): search by name, email, or phone; filter by status (Active, Email not confirmed, Blocked); block and unblock. With DummyJSON demo users: a read-only list. With BuyNest's backend (phase 6): filters by email confirmation, group, and join dates; CSV export; "Add customer"; and a customer page with tabs (Account and group, Addresses, Orders, Notes) and actions (password reset email, block/unblock, delete). |
| Customer groups | Phase 6: groups with a discount on every product price (General, Wholesale, VIP…); add, edit, delete when empty. |
| Create order | Phase 6 (Orders → Create order): a customer (search) or a guest, products with options and quantities, saved addresses, shipping, payment (bank transfer and cash are staff-only), coupon, note; live totals from the server. |
| Shipments, Returns | Phase 6: every shipment (search, carrier and date filters) with its packing slip; returns (RMA) with approve/reject, receive (condition, restock), close, and "Refund this return" through the credit memo dialog. |
| Order grid extras | Phase 6: a Source column (storefront or admin), CSV export, and mass actions on ticked orders: invoice, ship, cancel, print invoices, print packing slips. |
| Dashboard and bell (phase 7, system) | Overview grows into Magento's dashboard: lifetime sales, average order, a 30-day revenue chart (with a table), to-do counts (orders to invoice and ship, return requests, reviews to approve, low stock), bestsellers, new customers, and top search terms; each block only with its `*.view` permission. A notifications bell in the header (unread count in its name, checked every 60 seconds; a list with mark read and mark all read). |
| Email templates (phase 7) | Content → Email templates (`email_templates.manage`): every email the store sends; edit the subject and HTML body with the template's variables (insert at the cursor; required ones are checked), a live preview with sample data in a sandboxed frame, send a test to yourself, reset to default. |
| URL redirects (phase 7) | Content → URL redirects (`seo.manage`): add, edit, delete, import a CSV (`from_path,to_path[,status_code]`). Deleting a product or category, or changing a page's address, offers to add a redirect from the old address. |
| Grid settings (phase 7) | Products, Orders, and Customers: a column chooser, rows per page, and named saved filters, stored per admin on the server. Products also get meta title and description fields. |
| Catalog price rules (phase 7, marketing) | Marketing → Catalog price rules (read with `coupons.view`, change with `price_rules.manage`): automatic sales by percent or amount, limited by customer groups, categories (with their subcategories), and products, with dates, priority, and "stop further rules". The form shows the saved rule's affected products with their price now and with the rule. |
| Coupons as cart rules (phase 7) | Marketing → Coupons (`coupons.view`/`coupons.edit`): a code or an automatic rule (no code), percent, amount, free shipping, or buy X get Y free; minimum spend, customer groups, eligible categories or products, free shipping on top, uses per customer. The list filters codes and automatic rules; the coupon report names automatic rules. |
| Newsletter (phase 7) | Marketing → Newsletter subscribers (`newsletter.view`): status and source filters, counts, CSV export, unsubscribe (`newsletter.send`). Newsletter campaigns: an HTML editor with a live preview cleaned by the same allow-list as the server, save draft, send a test to yourself, send to every subscriber (after confirming), and the sent and failed counts. |
| Abandoned carts, Search terms (phase 7) | Marketing → Abandoned carts (`reports.view`): signed-in customers' unordered carts by age, subtotal, and name or email, with a Remind email (`newsletter.send`, once per 72 hours). Search terms (`reports.view`): top searches and searches with no results; with `seo.manage`, send a term straight to a page (its redirect), add or remove terms. |

## Who can use it

Shop staff with an **admin account**:

| Accounts (`VITE_ACCOUNTS_BACKEND`) | Admins | Local demo |
| --- | --- | --- |
| `laravel` | The `admins` table in the Laravel API, signed in with an email. Created with `php artisan buynest:create-admin`. | **admin@buynest.test / AdminPass2026** |
| `dummyjson` | DummyJSON demo users whose role is "admin", signed in with a username | **emilys / emilyspass** |

- **The server decides.** Every request to the admin API (`/api/admin/*`, in
  `frontend/server/adminApi.js`) checks the admin session with the accounts
  backend and answers 401/403 otherwise. Hiding screens here is only a convenience.
- **Separate from the store.** Admins sign in at `/admin/login` and get their own
  HttpOnly cookies (`buynest_admin_*`, sent only to `/api/admin`). Signing in or
  out of the store never signs anyone in or out of the admin, and the other way round.
- **Customers are refused.** With Laravel accounts a customer's email and password
  simply don't exist in the admins table; with DummyJSON a non-admin user is refused.
- The session lives in HttpOnly cookies; this app never sees a token.
- Customer records reach the browser allow-listed: no passwords, tokens, bank, SSN, or IP data.

The app reads `VITE_ACCOUNTS_BACKEND` from `../frontend/.env*` (`envDir`), so the store and the admin always agree.

## Demo data

Customers are real with BuyNest accounts. Products, orders, and the overview still
come from DummyJSON until backend phase 2: it accepts product changes and answers
as if it saved them, but it doesn't, and every page that changes something says so.
Orders placed in the store's demo checkout are saved only in that customer's
browser, so they aren't listed here.

## Run

```bash
npm install
# Usually started for you: `npm run dev` in ../frontend starts this dev server
# (port 5175) and serves it at http://localhost:5173/admin/.
npm test     # unit tests
npm run lint
```

`npm run build` in `../frontend` builds this app into `frontend/dist/admin`.

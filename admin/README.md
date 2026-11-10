# BuyNest Admin

The shop owner's dashboard: a separate React app, served at **`/admin/`** on the
storefront's address so it shares the sign-in session.

| Page | What it does |
| --- | --- |
| Overview | Revenue, average order, units sold, products, low stock, customers, inventory value; products that need restocking; latest orders |
| Products | Search, category filter, sorting, pages; add, edit, and delete products (with server-side validation) |
| Orders | All orders with pages; order details with items, totals, and the customer |
| Customers | Customer accounts with search (contact details only) |

## Who can use it

Only accounts with the role **admin** (DummyJSON demo: `emilys / emilyspass`).

- **The server decides.** Every request to the admin API (`/api/admin/*`, in
  `frontend/server/adminApi.js`) checks the signed-in account's role and answers
  403 for anyone else. Hiding screens in this app is only a convenience.
- **One sign-in for both apps.** Admins signed in on the store open the dashboard
  directly (the store's account page shows a "Shop admin" link). Signing out in
  either app signs out both.
- A customer who signs in on the admin page is refused and signed back out.
- The session lives in HttpOnly cookies; this app never sees a token.
- Customer records reach the browser allow-listed: no passwords, bank, SSN, or IP data.

## Demo data

The data comes from DummyJSON. It accepts product changes and answers as if it
saved them, but it doesn't: every page that changes something says so. Orders
placed in the store's demo checkout are saved only in that customer's browser,
so they aren't listed here. Both change when the Laravel backend exists: the
admin API's routes become Laravel endpoints with the same shapes.

## Run

```bash
npm install
# Usually started for you: `npm run dev` in ../frontend starts this dev server
# (port 5175) and serves it at http://localhost:5173/admin/.
npm test     # unit tests
npm run lint
```

`npm run build` in `../frontend` builds this app into `frontend/dist/admin`.

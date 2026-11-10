# BuyNest Admin

The shop staff's dashboard: a separate React app, served at **`/admin/`** on the
storefront's address. Admins have their **own accounts and their own sign-in**,
separate from customers.

| Page | What it does |
| --- | --- |
| Overview | Revenue, average order, units sold, products, low stock, customers, inventory value; products that need restocking; latest orders |
| Products | Search, category filter, sorting, pages; add, edit, and delete products (with server-side validation) |
| Orders | All orders with pages; order details with items, totals, and the customer |
| Customers | The real sign-ups (BuyNest accounts): search by name, email, or phone; filter by status (Active, Email not confirmed, Blocked); block and unblock. With DummyJSON demo users: a read-only list. |

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

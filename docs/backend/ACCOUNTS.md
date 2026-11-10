# Accounts: how sign-up, sign-in, and admin access work

Phase 1 of the real backend. This page explains the design and why each piece is there, so you can reason about it, not just run it.

## The pieces

```
Browser (storefront or admin)
   │  /api/auth/*  or  /api/admin/*      same address as the page; HttpOnly cookies
   ▼
Sign-in service (frontend/server, "backend for frontend")
   │  /api/v1/*  or  /api/admin/v1/*     server to server; Bearer token + shared key
   ▼
Laravel API (backend/)  ──▶  MySQL: customers, admins, one_time_codes, personal_access_tokens
```

Why a service in the middle? Laravel issues **tokens**. If the browser held them (localStorage, a readable cookie), any script injected into the page could steal them. The sign-in service keeps them in cookies marked:

- `HttpOnly`: page JavaScript can't read them;
- `Secure`: HTTPS only;
- `SameSite=Strict`: never sent when a request starts on another website;
- `Path=/api` (customers) or `Path=/api/admin` (admins): only sent to BuyNest's services.

It also translates between the API's `snake_case` and the React app's `camelCase`, and passes on only safe fields.

## Customer sign-up, step by step

1. **Sign-up form** (`/register`): first name, last name, email, phone, password. The browser checks the fields for quick feedback; **the server checks them again** (anyone can skip browser code).
2. **Laravel creates the customer unconfirmed** (`email_verified_at` is empty) and emails a **6-digit code**.
3. **Code page** (`/verify-email`): the customer types the code. The right code sets `email_verified_at` and signs them in straight away.
4. Unconfirmed customers **can't sign in**: the sign-in answers `403 email_unverified`, emails a new code, and the app continues on the code page.

### Why the codes are safe

| Rule | Protects against |
| --- | --- |
| Only an HMAC of the code is stored (keyed with `APP_KEY`) | A database leak revealing working codes |
| Expires after 10 minutes, works once | Old emails being reused |
| 5 wrong guesses lock it (a database lock stops parallel guesses slipping through) | Guessing: 5 tries out of 1,000,000 |
| One new code per minute per email, plus rate limits per visitor and per email | Flooding someone's inbox |
| A new code replaces the old one | Several valid codes at once |
| Reset codes and sign-up codes are separate (`purpose`) | Using a sign-up code to change a password |

### Not giving away who has an account

- Sign-in: a wrong password and an unknown email get the **same message**, and the server checks a password hash either way, so the response time doesn't tell either.
- Forgot password and "send a new code": the **same answer** whether or not the email has an account.
- Sign-up is the one exception: it has to say "an account with this email already exists", like every store.

## Tokens and sessions

On sign-in Laravel issues a **pair** of Sanctum tokens:

- **access** (60 minutes): used on every request;
- **refresh** (1 day, or 7 days with "Keep me signed in"): can only be swapped for a new pair. The swap deletes the old pair (**rotation**), so a stolen refresh token stops working as soon as the real customer uses theirs.

Sign-out deletes the pair in the database, not just the cookies. A password reset or an admin blocking the account deletes **every** token, so all devices are signed out.

## Customers and admins never mix

Like Magento (`customer_entity` vs `admin_user`), they are **separate tables**:

- **Separate sign-in**: `/api/v1/auth/login` only looks at `customers`; `/api/admin/v1/auth/login` only at `admins`. A customer's email and password don't work at the admin, ever.
- **Separate tokens**: customer tokens carry the ability `customer`, admin tokens `admin`. The `token.kind` middleware refuses the wrong kind on every route, and runs **before** a record is looked up, so a customer can't even learn which customer ids exist.
- **Separate cookies**: `buynest_at` for customers, `buynest_admin_at` for admins. Signing in or out of one never touches the other.
- **No way to become an admin from the storefront.** Admins are created by another admin (phase 4) or with `php artisan buynest:create-admin`.

## Admin: managing customers

`/admin/customers` lists the real sign-ups: name, email, phone, status (Active, Email not confirmed, Blocked; shown as icon and words, never colour alone), when they joined, and their last sign-in. Search covers name, email, and phone.

**Block** asks for confirmation, then signs the customer out everywhere and stops them signing in until an admin unblocks the account.

## Visitor addresses and rate limits

Every request to Laravel comes from the sign-in service, so Laravel would see one address for every visitor, and one person's failed sign-ins could lock everyone out. The service therefore passes on the visitor's IP (`X-Client-IP`) together with a **shared key** (`BFF_SHARED_KEY` in Laravel = `BUYNEST_BFF_KEY` in the frontend). Laravel only believes the header when the key matches, so nobody else can fake their address. On the dev server the address comes from the network connection, never from a header the browser sent.

## Email in development

`DEV_MAILBOX=true` with `APP_ENV=local` keeps a copy of every email in the `dev_mailbox` table. Read them at http://127.0.0.1:8000/dev/mailbox. The email body is shown in a sandboxed frame, so its HTML can't run scripts. Switching to real email is a settings change only: see [backend/README.md](../../backend/README.md#email).

## Choosing the accounts source

`VITE_ACCOUNTS_BACKEND` (in `frontend/.env.local`; the admin app reads the same file):

| Value | Accounts |
| --- | --- |
| `laravel` | BuyNest's API: everything on this page |
| `dummyjson` (default) | DummyJSON's public demo users. Sign-up and password reset are only simulated; admins are demo users whose role is "admin". |

The product catalog is a separate setting (`VITE_API_PROVIDER`) and still uses DummyJSON until phase 2.

## Where the code is

| What | Where |
| --- | --- |
| Codes, tokens | `backend/app/Services/OneTimeCodes.php`, `TokenPairs.php` |
| Endpoints | `backend/app/Http/Controllers/Api/V1/CustomerAuthController.php`, `Api/Admin/*` |
| Customer/admin separation | `backend/app/Http/Middleware/EnsureTokenKind.php` |
| Shared key, visitor IP | `backend/app/Http/Middleware/TrustBffClientIp.php`, `frontend/server/http.js` |
| Sign-in service | `frontend/server/authBff.js`, `adminApi.js`, `accounts/laravel.js` |
| Pages | `frontend/src/pages/RegisterPage.jsx`, `VerifyEmailPage.jsx`, `ForgotPasswordPage.jsx`, `LoginPage.jsx` |
| Admin customers | `admin/src/pages/CustomersPage.jsx` |
| Tests | `backend/tests/Feature/*`, `frontend/server/api.test.js`, `frontend/src/pages/AccountPages.laravel.test.jsx`, `e2e/signup.mjs`, `e2e/admin.mjs` |

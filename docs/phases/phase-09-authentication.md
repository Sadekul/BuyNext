# Phase 9 — User registration and authentication

**Goal:** sign-in, registration, password reset, a protected account area, and sign-out, using DummyJSON's demo auth API.

> **Learning implementation, not real security.** BuyNest keeps tokens in Web Storage and hides pages in React. Neither protects data on its own. Production authentication arrives with the Laravel backend (Sanctum), described below.

## What was built

| Feature | Where | API |
| --- | --- | --- |
| Login (with "Keep me signed in") | `pages/LoginPage.jsx` | `POST /auth/login` |
| Registration (**simulated**) | `pages/RegisterPage.jsx` | `POST /users/add` (returns 201, saves nothing) |
| Forgot password (**simulated**) | `pages/ForgotPasswordPage.jsx` | none exists; neutral message, no email sent |
| Customer profile | `pages/ProfilePage.jsx` | `GET /auth/me` with `Authorization: Bearer <token>` |
| Account navigation + sign-out | `layouts/AccountLayout.jsx` | — (no logout endpoint) |
| Protected routes | `routes/ProtectedRoute.jsx` | — |
| Guest-only routes (`/login`, `/register`) | `routes/GuestOnlyRoute.jsx` | — |
| Session restore, refresh, expiry | `context/AuthProvider.jsx` | `GET /auth/me`, `POST /auth/refresh` |
| Header "Hi, Emily" / "Sign in" | `components/layout/Header.jsx` | — |

Demo account: **emilys / emilyspass** (from the public list at https://dummyjson.com/users).

## Authentication vs authorization
- **Authentication:** *who are you?* (sign in with a username and password and get a token)
- **Authorization:** *what may you do?* (a customer may read **their** orders; only an admin may edit products)

The frontend can only **ask**; the server **decides**, on every request.

## Session-based vs token-based authentication

| | Session (cookie) | Token (JWT in a header) |
| --- | --- | --- |
| After login | Server stores a session and sends an **HttpOnly** cookie | Server returns tokens; the client stores and sends them |
| Sent how | Browser attaches the cookie automatically | `Authorization: Bearer …` added by our code |
| Readable by JavaScript | No (HttpOnly) | Yes, so an XSS bug can steal it |
| Needs CSRF protection | Yes (SameSite + CSRF token) | No (not sent automatically) |
| Good for | Your own website on your own domain | Mobile apps, third-party API clients |

## Access tokens and refresh tokens
- **Access token:** short-lived (BuyNest asks for 60 minutes), sent with each API request.
- **Refresh token:** long-lived, used only to get a new access token.

```
request with access token ──▶ 401 Unauthorized (expired)
       │
       ▼
POST /auth/refresh { refreshToken } ──▶ new tokens ──▶ retry the request once
       │ (refresh also fails)
       ▼
sign out, "Your session has expired. Please sign in again."
```
`authorizedRequest(request)` in `AuthProvider` implements this; the profile page uses it. At startup, `verifyStoredSession` does the same check for a stored session.

## 401 vs 403 (and what DummyJSON actually returns)
| Code | Meaning | BuyNest |
| --- | --- | --- |
| **401 Unauthorized** | Not authenticated: missing, invalid, or expired token | Refresh once, then sign out (`/auth/me` returns 401 "Invalid/Expired Token!") |
| **403 Forbidden** | Authenticated, but not allowed | Show "You don't have permission" (`STATUS_MESSAGES[403]` in `apiClient`); never retry |
| 400 Bad Request | Invalid input | DummyJSON returns **400 "Invalid credentials"** for a wrong password (not 401) |

## Secure cookie considerations (the production plan)
With **Laravel Sanctum SPA authentication**:
1. `GET /sanctum/csrf-cookie`, then `POST /login` with credentials.
2. Laravel sets a session cookie: `HttpOnly` (JavaScript can't read it), `Secure` (HTTPS only), `SameSite=Lax` (blocks most cross-site requests).
3. Every request uses `fetch(url, { credentials: 'include' })` and the `X-XSRF-TOKEN` header.
4. No tokens in localStorage at all. Logout calls `POST /logout`, which destroys the server session.

Because only `services/authService.js` and `AuthProvider` know how tokens work, that switch doesn't touch the pages.

## Protected routes
```jsx
<Route element={<ProtectedRoute />}>
  <Route path="account" element={<AccountLayout />}>
    <Route index element={<ProfilePage />} />
    <Route path="orders" element={…} />
  </Route>
</Route>
```
`ProtectedRoute` shows a loader while the stored session is being checked, redirects anonymous visitors to `/login` with `state.from`, and renders `<Outlet />` otherwise. After login, `LoginPage` sends the customer back to `state.from` (e.g. `/account/orders`).

**Hiding a route is not security.** Anyone can edit JavaScript in DevTools and render the page anyway. What protects the data is the API rejecting requests without a valid token.

## Client-side vs server-side validation
- **Client-side** (`utils/validation.js`): instant, friendly messages. Errors are *derived* from the values; we only *show* them after a field is left (`touched`) or the form is submitted. The first invalid field receives focus. Each field is wired with `aria-invalid` and `aria-describedby` (`components/forms/FormField.jsx`).
- **Server-side**: required for correctness and security; it can check things the browser can't (is the email already registered? is the password breached?). The browser checks are a courtesy.

## Handling expired sessions
- **On startup:** a stored session is verified (`/auth/me`), refreshed once if needed, otherwise cleared with a message.
- **During use:** `authorizedRequest` refreshes on 401 and retries once.
- **Across tabs:** signing out removes the stored session; the `storage` event signs out the other tabs.

### A real bug the browser tests found
Saving the session used to *remove* the key and then *set* it again. In another tab, that removal fired a `storage` event with `newValue === null`, which means "signed out". So opening the account page in a second tab signed out the first tab, whose own save then signed out the second. The fix overwrites the key in place and only clears the *other* storage area. The test now opens a second tab and checks the first stays signed in.

## Privacy: allow-list user fields
`GET /auth/me` returns the user's password, bank card, SSN, IP, and more. `normalizeUser` copies only id, username, name, email, image, phone, and address. The browser test checks that none of the sensitive values reach the page or storage.

## Verify it
1. Visit `/account/orders` signed out → redirected to `/login`; sign in with the demo account → back on `/account/orders`.
2. Submit the empty login form → both errors, focus on Username. Wrong password → "Invalid credentials".
3. Untick "Keep me signed in" → the session is in `sessionStorage` (DevTools → Application); tick it → `localStorage`.
4. In storage, change `accessToken` to `x` and reload → still signed in (refreshed; see `POST /auth/refresh` in the Network tab). Change both tokens → "Your session has expired".
5. Sign out in one tab → the other tab goes to `/login`.
6. Register → the success screen explains DummyJSON didn't save the user.

## Common errors
- **Redirect loop between `/login` and `/account`:** a guard reading a stale state. Show a loader while `status === 'checking'`.
- **"Access Token is required" (401):** the `Authorization` header is missing or not prefixed with `Bearer `.
- **CORS error only on login:** custom headers trigger a preflight; the API must allow them (DummyJSON does).

## Practice
Read the `exp` claim from the access token (a JWT is `header.payload.signature`; the payload is base64url JSON) and refresh the session **before** it expires instead of waiting for a 401.

## Interview questions
1. **Authentication vs authorization?** Who you are vs what you're allowed to do.
2. **Why is storing a JWT in localStorage risky, and what's better?** Any injected script can read it. HttpOnly, Secure, SameSite cookies can't be read by JavaScript (but need CSRF protection).
3. **401 vs 403?** 401 = not authenticated (sign in or refresh); 403 = authenticated but not permitted.
4. **Does a protected route secure data?** No; it only improves UX. The server must enforce access on every request.
5. **Why use refresh tokens?** Short-lived access tokens limit damage if stolen; the refresh token renews them without asking for the password again.

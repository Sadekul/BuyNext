# Deploying the BuyNest frontend

BuyNest is a **static single-page app**: `npm run build` produces HTML, CSS, and JS in `frontend/dist/` that any static host can serve.

## Production build
```bash
cd frontend
npm ci              # exact versions from package-lock.json
npm run lint
npm test
npm run build       # → dist/
npm run preview     # check it at http://localhost:4173
```
- File names contain content hashes (`index-DKsIZ52h.js`), so they can be cached forever; `index.html` must not be cached long.
- Vite inlines `VITE_*` variables **at build time**. Changing them requires a new build.

## SPA fallback routing
The server only has `index.html`; routes like `/products/123` exist only in React Router. Without a fallback, refreshing a deep link returns **404**. Every host must serve `index.html` for unknown paths:

| Host | Configuration (already in the repo) |
| --- | --- |
| Vercel | `frontend/vercel.json` → `"rewrites": [{ "source": "/((?!api/).*)", "destination": "/index.html" }]` (everything except the sign-in service) |
| Netlify | `frontend/public/_redirects` → `/*  /index.html  200` (copied into `dist/`) |
| Nginx | `location / { try_files $uri /index.html; }` |
| Apache | `FallbackResource /index.html` |

Both configs also set long-term caching for `/assets/*` and basic security headers (`X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`).

**Content-Security-Policy.** `npm run build` adds a CSP `<meta>` tag to `dist/index.html` (see `vite.config.js`). It allows scripts and styles only from the site itself (plus Google Fonts), images from the site, `cdn.dummyjson.com` and the API, and network requests only to the site and the origin in `VITE_API_BASE_URL`. Because the API origin is read at build time, a Laravel build gets the right policy automatically. If you add another image host, analytics, or a payment script, add its origin there, or the browser will block it. The dev server has no CSP, because hot reload needs inline scripts.

**Sign-in service.** Sign-in needs a small server function at `/api/auth/*` ([server/authBff.js](../frontend/server/authBff.js)); it keeps the session in HttpOnly cookies so no token reaches the browser. Both hosts pick it up from the repo with no extra settings: Vercel from `frontend/api/auth/[action].js`, Netlify from `frontend/netlify/functions/auth.mjs` (its `config.path` maps it to `/api/auth/:action`). Static hosts without functions (Nginx, Apache, S3) need that service run somewhere and proxied at `/api/auth/` on the same domain, or sign-in won't work. The cookies are `Secure`, so the site must be served over HTTPS (`http://localhost` is the exception browsers allow).

> **Verified locally only.** The service, cookies, sign-out, and session renewal are tested in `npm run dev` and `npm run preview` (unit tests in `server/authBff.test.js` plus browser checks). The Vercel and Netlify function wrappers are two-line adapters around the same code, but they have not been run on a real deployment yet: after the first deploy, sign in, reload, and sign out once to confirm.

## Vercel
1. Import the GitHub repository.
2. **Root directory:** `frontend`. Framework preset: Vite (build `npm run build`, output `dist`; also set in `vercel.json`).
3. Environment variables: `VITE_API_BASE_URL=https://dummyjson.com` (and later `VITE_API_PROVIDER=laravel` + your API URL).
4. Deploy. Every pull request gets a preview URL.

## Netlify
1. Add the site from GitHub.
2. **Base directory:** `frontend` · **Build command:** `npm run build` · **Publish directory:** `frontend/dist`.
3. Environment variables as above. `public/_redirects` and `public/_headers` are picked up automatically.

## Environment variables per environment
| Variable | Development | Production (today) | Production (with Laravel) |
| --- | --- | --- | --- |
| `VITE_API_BASE_URL` | `https://dummyjson.com` | `https://dummyjson.com` | `https://api.buynest.com` |
| `VITE_API_PROVIDER` | `dummyjson` | `dummyjson` | `laravel` |
| `VITE_SHOW_LEARNING_LAB` | (always on) | `false` | `false` |

With Laravel: the API must allow the storefront's origin in CORS with credentials, and the session cookie domain must cover both sites (see `docs/backend/API_CONTRACT.md`).

## Release checklist
- [ ] `npm run lint` passes, `npm test` passes
- [ ] No `console.log` / `debugger` left (`grep -rn "console.log\|debugger" src`)
- [ ] `.env.example` documents every variable; no secrets in `VITE_*`
- [ ] `npm run build` succeeds; `npm run preview` works
- [ ] Deep links load after a refresh (`/products/123`, `/categories/laptops?brand=Apple`)
- [ ] Layout checked at phone (390 px), tablet (768 px), desktop (1440 px)
- [ ] Keyboard-only walkthrough; Lighthouse/axe accessibility audit
- [ ] Demo notices still visible for simulated features (checkout, registration)

**Last verified (production build via `vite preview`):** deep links, no failed requests or console errors, no horizontal overflow on home, catalog, details, login, and register at all three widths, one `<h1>` per page, and **zero axe-core violations** on home, catalog, details, login, register, account, cart, cart drawer, and checkout.

# Deploying the BuyNest frontend

BuyNest is a **static single-page app**: `npm run build` produces HTML, CSS, and JS in `frontend/dist/` that any static host can serve.

> **Deploying the whole shop (API + database + store)?** Follow [DEPLOY_RAILWAY.md](DEPLOY_RAILWAY.md): the Laravel API, its queue worker and scheduler, and MySQL on Railway, the store and admin on Vercel, Stripe's webhook, and an after-deploy checklist. Email setup (Brevo or Mailgun, DNS records, testing) is in [EMAIL.md](EMAIL.md). This page covers the frontend build and static hosting in general.

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

**Server functions (sign-in and admin API).** BuyNest needs two small server-side services on its own domain, both in [server/api.js](../frontend/server/api.js): the sign-in service at `/api/auth/*` (keeps the session in HttpOnly cookies, so no token reaches the browser) and the admin API at `/api/admin/*` (checks the admin role on every request). Both hosts pick them up from the repo with no extra settings: Vercel from `frontend/api/auth/[action].js` and `frontend/api/admin/[...path].js`, Netlify from `frontend/netlify/functions/api.mjs` (its `config.path` maps it to `/api/auth/:action` and `/api/admin/*`). Static hosts without functions (Nginx, Apache, S3) need that service run somewhere and proxied at `/api/` on the same domain, or sign-in and the admin won't work. The cookies are `Secure`, so the site must be served over HTTPS (`http://localhost` is the exception browsers allow).

**Admin dashboard.** `npm run build` builds the store into `dist/` and the admin app (`../admin`) into `dist/admin/`, so the admin needs its packages installed before the build (see the host steps below). `/admin/*` is routed to the admin app (`vercel.json`, `public/_redirects`) and sent with `X-Robots-Tag: noindex` so search engines skip it.

> **Verified locally only.** The services, cookies, sign-out, session renewal, and the admin API are tested in `npm run dev` and `npm run preview` (unit tests in `server/api.test.js`, plus the browser checks in `e2e/`). The Vercel and Netlify function wrappers are two-line adapters around the same code, but they have not run on a real deployment yet: after the first deploy, sign in on the store, reload, open `/admin/`, and sign out once to confirm.

## Vercel
1. Import the GitHub repository.
2. **Root directory:** `frontend`. Framework preset: Vite (build `npm run build`, output `dist`; also set in `vercel.json`, whose `installCommand` also installs `../admin`). Keep "Include source files outside of the Root Directory" enabled (the default): the build needs `../admin`.
3. Environment variables: `VITE_API_BASE_URL=https://dummyjson.com` for the DummyJSON demo. With the Laravel API, use the full list in [DEPLOY_RAILWAY.md → Vercel](DEPLOY_RAILWAY.md#9-vercel-the-store-and-the-admin) (`VITE_API_PROVIDER`, `VITE_ACCOUNTS_BACKEND`, `VITE_API_BASE_URL`, `BUYNEST_LARAVEL_URL`, `BUYNEST_BFF_KEY`).
4. Deploy. Every pull request gets a preview URL.

## Netlify
1. Add the site from GitHub.
2. **Base directory:** `frontend` · **Build command:** `npm --prefix ../admin ci && npm run build` (installs the admin app's packages first) · **Publish directory:** `frontend/dist`.
3. Environment variables as above. `public/_redirects` and `public/_headers` are picked up automatically.

## Environment variables per environment
| Variable | Development | Production (today) | Production (with Laravel) |
| --- | --- | --- | --- |
| `VITE_API_BASE_URL` | `https://dummyjson.com` | `https://dummyjson.com` | `https://api.buynest.com` |
| `VITE_API_PROVIDER` | `laravel` | `dummyjson` | `laravel` (the catalog is then read through the store's own `/api/catalog/*`; `VITE_API_BASE_URL` isn't needed) |
| `VITE_SHOW_LEARNING_LAB` | (always on) | `false` | `false` |
| `VITE_ACCOUNTS_BACKEND` | `laravel` | `dummyjson` | `laravel` |
| `BUYNEST_LARAVEL_URL` (server only) | `http://127.0.0.1:8000` | — | the API's URL, reachable from the server functions |
| `BUYNEST_BFF_KEY` (server only, secret) | in `.env.local` | — | the same value as the API's `BFF_SHARED_KEY` |

Variables without the `VITE_` prefix are only read by the server functions (`frontend/server/`), never bundled into browser code: set them in the host's environment settings (Vercel/Netlify), not in a committed file.

With Laravel accounts the browser never calls the API: only the server functions do, so the API needs no CORS settings for the storefront. Deploy the API itself with the [production checklist](../backend/README.md#production-checklist) (`APP_DEBUG=false`, `DEV_MAILBOX=false`, a real mailer, the scheduler running); on Railway, [DEPLOY_RAILWAY.md](DEPLOY_RAILWAY.md) does all of that step by step (Docker image in `backend/Dockerfile`), and [EMAIL.md](EMAIL.md) sets up the mailer. When the server functions run on Vercel or Netlify, the API needs a public address (they can't reach a private network); the shared key and what it protects are explained in [DEPLOY_RAILWAY.md](DEPLOY_RAILWAY.md#why-the-api-is-public-and-what-the-shared-key-does).

## Product photos (`/media`)

Photos uploaded in the admin are stored by the Laravel API. Shoppers load them from the store's own address, `/media/products/{id}/{file}`: a server function (`frontend/server/mediaApi.js`; `api/media` on Vercel, `netlify/functions/media.mjs` on Netlify) fetches them from `BUYNEST_LARAVEL_URL/storage/...` and sends them with a one-year cache header. Only file names the API creates are accepted; anything else is a 404. Because the photos come from the store's own address, the Content-Security-Policy needs no change. On the API server, keep `storage/app/public` on persistent disk (see the [production checklist](../backend/README.md#production-checklist)); on Railway that's the volume in [DEPLOY_RAILWAY.md step 5](DEPLOY_RAILWAY.md#5-the-photo-volume).

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

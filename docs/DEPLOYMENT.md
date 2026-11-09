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
| Vercel | `frontend/vercel.json` → `"rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]` |
| Netlify | `frontend/public/_redirects` → `/*  /index.html  200` (copied into `dist/`) |
| Nginx | `location / { try_files $uri /index.html; }` |
| Apache | `FallbackResource /index.html` |

Both configs also set long-term caching for `/assets/*` and basic security headers (`X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`).

**Content-Security-Policy.** `npm run build` adds a CSP `<meta>` tag to `dist/index.html` (see `vite.config.js`). It allows scripts and styles only from the site itself (plus Google Fonts), images from the site, `cdn.dummyjson.com` and the API, and network requests only to the site and the origin in `VITE_API_BASE_URL`. Because the API origin is read at build time, a Laravel build gets the right policy automatically. If you add another image host, analytics, or a payment script, add its origin there, or the browser will block it. The dev server has no CSP, because hot reload needs inline scripts.

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

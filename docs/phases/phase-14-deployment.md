# Phase 14 — Deployment

**Goal:** a production build that's clean, accessible, correctly routed, and documented, ready to push and deploy.

## Checklist results
| # | Task | Result |
| --- | --- | --- |
| 1 | Review environment variables | 3 public `VITE_*` variables, all documented in `.env.example`; none secret |
| 2 | Remove debugging code | No `console.log`/`debugger` in `src`; the `/learn` lab (and Axios) is **excluded from production builds** |
| 3 | Run ESLint | Clean |
| 4 | Run tests | 94/94 Vitest tests; browser regression suites also pass |
| 5 | Check accessibility | axe-core found 3 real issues (fixed below); now **0 violations** on 9 key views |
| 6 | Build | `npm run build`: initial JS ≈ 320 KB (≈ 98 KB gzipped) + lazy chunks |
| 7 | Verify static assets | Favicon, scripts, styles all 200; no failed requests |
| 8 | Responsive layouts | No horizontal overflow at 390/768/1440 px on the main pages |
| 9 | Routing in production | Deep links work through the SPA fallback; unknown paths show the 404 page |
| 10 | Configure deployment | `vercel.json`, `public/_redirects`, `public/_headers`, `.nvmrc`, `engines` |
| 11 | Final README | `frontend/README.md`, `docs/DEPLOYMENT.md` |
| 12 | Push to GitHub | **Waiting for your go-ahead** (it publishes your code) |

## Accessibility issues found by axe (and fixed)
1. **Label in name (WCAG 2.5.3):** the footer logo's `aria-label="BuyNest home"` didn't contain its visible text (with the tagline), and the signed-in header link said "Hi, Emily" but was named "My account (signed in as Emily)". Voice-control users say what they *see*, so the accessible name must contain the visible label. The logo now uses its visible text; the account link is "Hi, Emily" plus a visually hidden ", my account".
2. On small screens that label was hidden with `display: none`, which also removes it from the accessible name. It now uses the visually-hidden technique instead.
3. **Heading order:** cart item titles (h3) followed the page h1 directly; a visually hidden h2 "Items in your cart" was added.

## Concepts

### Production build vs dev server
`npm run dev` serves source files individually with HMR and React's development checks (StrictMode double rendering, warnings). `npm run build` bundles, tree-shakes, and minifies; React runs in production mode. Always test with `npm run preview` before deploying.

### Build-time environment variables
`import.meta.env.VITE_X` is **replaced with its value when building**. Consequences: changing a variable needs a rebuild; values are visible to anyone in the bundle; dead branches disappear. `import.meta.env.DEV || VITE_SHOW_LEARNING_LAB === 'true'` becomes `false`, so the learning lab and Axios aren't shipped.

### SPA fallback
React Router changes the URL without asking the server. On a refresh, the server receives `/products/123` and has no such file, so it must answer with `index.html` (status 200) and let React Router render the page. See `docs/DEPLOYMENT.md` for each host.

### Caching
Hashed assets (`/assets/index-DKsIZ52h.js`) never change, so they're cached for a year (`immutable`). `index.html` is revalidated, so a deploy is picked up on the next visit. If a user's open tab requests an old lazy chunk after a deploy, `ErrorBoundary` offers "Reload page".

## Common deployment errors
| Symptom | Cause | Fix |
| --- | --- | --- |
| Blank page, console: "VITE_API_BASE_URL is not set" | Variable missing on the host | Add it in the host settings and redeploy |
| 404 on refresh of any page except `/` | No SPA fallback | `vercel.json` / `_redirects` / `try_files` |
| Assets 404 when served from a subfolder | Vite `base` is `/` | Set `base: '/subfolder/'` in `vite.config.js` |
| Works locally, old version in production | Cached `index.html` | Don't cache HTML long; hard refresh |
| CORS errors with the real API | Origin not allowed / credentials | Configure the API's CORS for the storefront domain |

## Interview questions
1. **Why do SPAs need a fallback route on the server?** The server doesn't know client-side routes; it must serve `index.html` for them.
2. **Can you put an API secret in a `VITE_` variable?** No: it's embedded in the public JavaScript bundle.
3. **Why hash asset file names?** So they can be cached forever and changed files get new URLs (cache busting).
4. **What would you check before every release?** Lint, tests, build, preview with deep links, responsive and accessibility checks, environment variables.

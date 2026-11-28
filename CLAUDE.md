# BuyNest — instructions for Claude

BuyNest is a Bangladesh-focused online store, built phase by phase: `frontend/` (React storefront + the sign-in service / BFF in `frontend/server`), `admin/` (React admin at `/admin/`), `backend/` (Laravel 13, PHP 8.5, MySQL), `e2e/` (Playwright browser suites), `docs/`. Setup (`./setup.sh` once on a new computer, then `./dev.sh`) and demo accounts: [README.md](README.md#getting-started). Where things stand: the Progress table in README (B1–B27) and [docs/SQA_REPORT.md](docs/SQA_REPORT.md).

The owner is learning professional development: explain in plain language what you did and why, and keep the docs teaching (LEARNING_LOG).

## Standing rules (from the owner — always follow)

- **Never push or deploy** without the owner's explicit approval in the current conversation. Commit locally after a verified phase; the owner runs `git push` themselves.
- **Never commit `BuyNest_React_Ecommerce_Development_Prompt.txt`** (it stays untracked). Stage with `git add README.md CLAUDE.md admin backend docs e2e frontend` (plus new root scripts by name), never `git add -A`.
- **Secrets only in `backend/.env` and `frontend/.env.local`** — never read, print, edit or commit them; add only empty variable *names* to `.env.example`.
- **No real external calls** in development or tests (Stripe, PayPal, SSLCommerz, Steadfast, Pathao, SMS providers, Google). Tests use `Http::fake()` + `Http::preventStrayRequests()`; browser suites use local stand-in servers or the log drivers.
- **Demo accounts:** never delete or change the email of `customer@buynest.test` (Ava) or `shopper2@buynest.test` (Ben); never turn on two-step sign-in for `admin@buynest.test`, and keep "require two-step" off.
- **No paid hosting suggestions** unless the owner asks (free options only: local, the Cloudflare quick-tunnel demo in [docs/DEMO.md](docs/DEMO.md)).
- **Honest store data:** no fake countdowns or "sold recently", "Best selling" only from real sales, coupons shown only while active, promotions promised only while switched on.
- **Design:** original work only. The 2026-11 layout follows the owner's reference (Pixelstrap Fastkart, a commercial template): never copy its code, CSS, markup, images, icons or text. Colours are tokens in `frontend/src/assets/styles/tokens.css` (palette A: emerald `#047857` + orange; `#c2410c` for text/buttons, bright `#f97316` for shapes only). Every text colour pair ≥ 4.5:1.
- **Linear** (if used): the organisation's summary-plus-fold posting format.

## How a phase is done

1. Write a contract in `docs/backend/PHASE<N>_CONTRACT.md` (ground rules, API shapes, admin, storefront, browser suite, docs).
2. Build backend / admin (+ its BFF routes) / storefront in parallel against it; feature off by default so older suites are unaffected.
3. Verify: backend `env -u AI_AGENT php artisan test` + `vendor/bin/pint --test`; `npx vitest run` + `npm run lint` + `npm run build` in `frontend/` and `admin/`; a new `e2e/<name>.mjs` suite added to `e2e/run-all.mjs`.
4. Full browser run on the dev server (`node e2e/run-all.mjs`), then on the production build (`npm run build` and `npm run preview` in `frontend/`, `BASE_URL=http://localhost:4173 node e2e/run-all.mjs`), then stop the preview. Rerun any failing suite alone and find the cause before calling it flaky.
5. Docs: README progress row, an SQA_REPORT section (problems found and fixes, check counts), LEARNING_LOG, contract marked built, `docs/I18N.md` for new Bangla words.
6. Check no file is 0 bytes, scan the staged diff for secrets, commit (message ends with the Co-Authored-By line), tell the owner to `git push`.

## Gotchas learned the hard way

- **Use the project's PHP and Node:** when the computer's defaults are too old, `setup.sh` links newer ones in `.tools/bin`; `dev.sh` and `demo.sh` use it on their own, but artisan, npm, vitest and the browser suites need `export PATH="$PWD/.tools/bin:$PATH"` first (from the repository root).
- **Never run two browser suites or two `run-all` runs at once** (they share the database and demo accounts).
- **Browser suites need the development request limits** that `./setup.sh` writes into a new `backend/.env` (a strict `.env` gives random 429s: empty grids, "no results", admin pages that never load). The running API reads `.env` only at start: after the owner changes it, restart `./dev.sh`, and check the live value in the `X-RateLimit-Limit` response header, not with tinker.
- **An interrupted browser run leaves its test data behind** (products, customers, settings such as reward points switched on): before the next run, find the leftovers and remove them the way that suite's own clean-up does.
- Run artisan with `env -u AI_AGENT` (Laravel compacts its output when it sees that variable). Migrations on the shared dev DB: forward `migrate` only, never `fresh`/`refresh`/`rollback`.
- The BFF maps API answers through allow-lists: a new API field must be added there too, with a proxy test (phase 17 lost `has_sales` this way).
- Read-only screenshots: `playwright-core` with `chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] })` in a temporary script under `e2e/` (delete it afterwards); `lib.launch()` clears the demo accounts' saved carts.
- React dev mode doubles requests; measure speed on the production build.
- After an interrupted session, check for empty files (`find … -size 0`) before carrying on.
- Bangla (`বাংলা`) is the second language everywhere (cookie `buynest_lang`); Bangla wording drafted by Claude still needs the owner's review (docs/I18N.md, docs/BANGLADESH.md).

## Ideas not started yet

Real sandbox tests with the owner's SSLCommerz / courier / SMS accounts (and courier payout statements), Bangla wording review, permanent hosting (only if the owner asks).

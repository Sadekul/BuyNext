# Deploying BuyNest: API on Railway, store and admin on Vercel

This guide takes you from a GitHub repository to a live shop, one click at a time. You run every step yourself; nothing here was deployed for you.

**What runs where**

| Piece | Where | What it is |
| --- | --- | --- |
| Laravel API (`backend/`) | Railway, service **api** | nginx + PHP-FPM in one container, built from `backend/Dockerfile` |
| Queue worker | Railway, service **worker** | the same image, sends newsletter batches and other queued work |
| Scheduler | Railway, service **scheduler** | the same image, runs the every-minute jobs (price rules, clean-ups) |
| Database | Railway, **MySQL** | managed MySQL with its own volume |
| Product photos | Railway **volume** on the api service | `/var/www/html/storage/app/public` |
| Store + admin + server functions | Vercel (`frontend/`) | static pages plus the sign-in service, admin API, media and payment functions |
| Card payments | Stripe Checkout | Stripe's hosted page; Stripe tells BuyNest the result through a webhook |
| Email | Brevo or Mailgun over SMTP | see [EMAIL.md](EMAIL.md) |

```
Shopper ──https──▶ Vercel (store, /admin, /api/* functions) ──https + shared key──▶ Railway api ──▶ MySQL
                                                                                       │
Stripe ──webhook──▶ Vercel /api/payments/stripe/webhook ──forwarded unchanged──────────┘
```

**Order of work:** Railway first (you need the API's address), then Vercel (you need the store's address), then go back to Railway to fill in the store's address, then Stripe.

**Before you start**, have these ready:
- The GitHub repository with this code, pushed to the branch you'll deploy (normally `main`).
- A Railway account on the **Hobby plan or higher** (sending email over SMTP doesn't work on Railway's free/trial plan; see [EMAIL.md](EMAIL.md#troubleshooting)).
- A Vercel account, a Stripe account (test mode is fine), and a Brevo or Mailgun account with your domain verified ([EMAIL.md](EMAIL.md)).
- A terminal with `openssl` (macOS and Linux have it; on Windows use Git Bash) to make secrets.

---

## 1. Make the two secrets

Run these on your own computer and keep the output somewhere safe (a password manager). Never commit them.

```bash
# APP_KEY: Laravel's encryption key. Either of these works:
cd backend && php artisan key:generate --show      # if PHP is installed
echo "base64:$(openssl rand -base64 32)"           # otherwise

# BFF_SHARED_KEY: the key the store's server functions show the API
openssl rand -hex 32
```

- `APP_KEY` looks like `base64:Zm9v…=`. Keep it forever: if it changes, encrypted data can't be read any more.
- The BFF key is 64 letters and digits. It goes into Railway as `BFF_SHARED_KEY` and into Vercel as `BUYNEST_BFF_KEY` (the same value).

## 2. Create the Railway project and the api service

1. Railway dashboard → **New Project** → **Deploy from GitHub repo** → pick the BuyNest repository. (The first time, Railway asks to install its GitHub app; allow it for this repository.)
2. Railway creates a service and starts a build that will fail or do the wrong thing, because the app lives in `backend/`. That's expected. Click the service → **Settings**:
   - **Service name** (top): `api`. Later variables refer to it by this name.
   - **Source → Root Directory:** `backend`
   - **Source → Branch:** `main` (or the branch you deploy).
   - **Config-as-code → Railway Config File:** `/backend/railway.json` (the path is from the top of the repository, not from the root directory).
   - **Build:** Railway shows "Dockerfile" once the root directory is set (the config file says so too).
3. Don't deploy yet: first add the database and the variables.

What `backend/railway.json` sets for you: build with `backend/Dockerfile`, rebuild only when files under `backend/` change, health check at `/up` (up to 5 minutes, because migrations run first), restart on failure up to 10 times.

## 3. Add MySQL

1. In the project canvas: **Create** (or **+ New**) → **Database** → **MySQL**.
2. Leave its name as **MySQL**. Railway gives it a volume and these variables: `MYSQLHOST`, `MYSQLPORT`, `MYSQLDATABASE`, `MYSQLUSER`, `MYSQLPASSWORD`. You'll point Laravel at them with references like `${{MySQL.MYSQLHOST}}`, so the password is never copied by hand and the connection uses Railway's private network (free, not reachable from the internet).
3. MySQL → **Backups** (on its volume): turn on scheduled backups.

## 4. Variables for the api service

api service → **Variables** → **Raw Editor**, paste this block, then replace the values marked `<…>`:

```dotenv
CONTAINER_ROLE=web

APP_NAME=BuyNest
APP_ENV=production
APP_DEBUG=false
APP_KEY=<base64:… from step 1>
APP_URL=https://${{api.RAILWAY_PUBLIC_DOMAIN}}
LOG_CHANNEL=stderr
LOG_LEVEL=info

DB_CONNECTION=mysql
DB_HOST=${{MySQL.MYSQLHOST}}
DB_PORT=${{MySQL.MYSQLPORT}}
DB_DATABASE=${{MySQL.MYSQLDATABASE}}
DB_USERNAME=${{MySQL.MYSQLUSER}}
DB_PASSWORD=${{MySQL.MYSQLPASSWORD}}

SESSION_DRIVER=database
CACHE_STORE=database
QUEUE_CONNECTION=database
FILESYSTEM_DISK=local
BCRYPT_ROUNDS=12

DEV_MAILBOX=false
BFF_SHARED_KEY=<64 characters from step 1>
STOREFRONT_URL=<https://your-store.vercel.app — fill in after step 9>

MAIL_MAILER=smtp
MAIL_SCHEME=smtp
MAIL_HOST=<smtp-relay.brevo.com or smtp.mailgun.org>
MAIL_PORT=587
MAIL_USERNAME=<from EMAIL.md>
MAIL_PASSWORD=<from EMAIL.md>
MAIL_FROM_ADDRESS=<no-reply@yourdomain.com>
MAIL_FROM_NAME=BuyNest

STRIPE_SECRET_KEY=<sk_test_… — leave empty to keep manual card payments>
STRIPE_WEBHOOK_SECRET=<whsec_… — fill in after step 11>
STRIPE_CURRENCY=usd
STRIPE_CHECKOUT_MINUTES=30

BUYNEST_AUTH_PER_MINUTE=30
BUYNEST_AUTH_PER_EMAIL_PER_MINUTE=10
BUYNEST_ORDERS_PER_MINUTE=10
BUYNEST_REVIEWS_PER_HOUR=10
BUYNEST_API_PER_MINUTE=240
BUYNEST_REQUIRE_BFF_KEY=true
BUYNEST_NEWSLETTER_PER_MINUTE=10
BUYNEST_NEWSLETTER_PER_EMAIL_PER_HOUR=3
BUYNEST_STRIPE_WEBHOOKS_PER_MINUTE=300
BUYNEST_CODE_TTL_MINUTES=10

PHP_FPM_MAX_CHILDREN=10
```

What each group means:

| Variable | What it is |
| --- | --- |
| `CONTAINER_ROLE` | Which job this container does: `web` (the API), `worker`, or `scheduler`. Same image, different job. |
| `APP_ENV=production`, `APP_DEBUG=false` | Production mode. With debug on, error pages would show code and secrets to anyone. Never `true` here. |
| `APP_KEY` | Encryption key from step 1. |
| `APP_URL` | The API's own public address. `${{api.RAILWAY_PUBLIC_DOMAIN}}` is filled in by Railway once the domain exists (step 6). If you use a custom domain, write it out: `https://api.yourdomain.com`. |
| `LOG_CHANNEL=stderr` | Laravel's log goes to Railway's **Logs** tab instead of a file inside the container. |
| `DB_*` | References to the MySQL service (Railway fills them in). |
| `SESSION_DRIVER`, `CACHE_STORE`, `QUEUE_CONNECTION` | Keep sessions, cache and queued jobs in MySQL, so every container sees the same data. `QUEUE_CONNECTION=database` sends newsletter batches through the worker (step 7). |
| `DEV_MAILBOX=false` | The local test inbox; off in production (it only ever works with `APP_ENV=local` anyway). |
| `BFF_SHARED_KEY` | The store's server functions send it with every call; see "Why the API is public" below. |
| `BUYNEST_REQUIRE_BFF_KEY` | `true`: the API refuses every call that doesn't carry `BFF_SHARED_KEY`, so only your store can use it. |
| `STOREFRONT_URL` | The store's address, used in email links (newsletter, cart reminders), the sitemap, and Stripe's return pages. No trailing slash. |
| `MAIL_*` | Your email provider: exact values in [EMAIL.md](EMAIL.md). |
| `STRIPE_*` | Card payments. Stripe is switched on only when `STRIPE_SECRET_KEY` is set; without it card orders wait for an admin to invoice them. `STRIPE_CHECKOUT_MINUTES` is how long the payment page stays open (30 minimum). |
| `BUYNEST_*` | Rate limits (requests per visitor per minute or hour) and how long emailed codes last. The values above are the defaults from `backend/.env.example`; raise them only if real shoppers get "Too many attempts". |
| `PHP_FPM_MAX_CHILDREN` | How many requests PHP handles at the same moment (each uses about 30–60 MB of memory). 10 suits a small Railway instance; minimum 2. |

## 5. The photo volume

Uploaded product photos must survive redeploys, so they live on a Railway volume, not inside the container.

1. Project canvas → right-click the **api** service → **Attach volume** (or **Create → Volume** and pick api).
2. **Mount path:** `/var/www/html/storage/app/public`
3. Volume → **Backups:** turn on scheduled backups.

Good to know:
- A volume belongs to one service. Only **api** gets it; the worker and scheduler don't handle photos.
- While a service with a volume redeploys, Railway stops the old container before starting the new one, so the API is unavailable for roughly the build-to-healthy time (usually under a minute). The store keeps loading; signing in and checkout wait until it's back.
- Railway mounts volumes owned by `root`. The container starts as root only long enough to give that folder to the `www-data` user, then runs everything as `www-data` (see `backend/docker/start.sh`).

## 6. Public domain and first deploy

1. api service → **Settings → Networking → Public Networking → Generate Domain**. If Railway asks for a port, enter **8080** (the container listens on Railway's `PORT`, which is 8080 unless you change it).
2. You get an address like `https://buynest-api-production.up.railway.app`. Note it: it's the API URL for Vercel.
3. Click **Deploy** (or **Deploy changes** at the top of the canvas). Watch **Deployments → View logs**. A healthy start looks like:
   ```
   INFO  Configuration cached successfully.
   …
   INFO  Running migrations.   (first time: a long list)
   INFO  The [public/storage] link has been connected to [storage/app/public].
   [buynest:web] serving on port 8080 (nginx …, php-fpm …)
   ```
4. Open `https://<api domain>/up` → a page saying the application is up. Open `https://<api domain>/api/v1/store` → JSON.

**Optional custom domain:** Settings → Networking → **Custom Domain** → `api.yourdomain.com`, add the CNAME record Railway shows at your DNS host, wait for the green tick. Then use `https://api.yourdomain.com` for `APP_URL` here and for `BUYNEST_LARAVEL_URL` / `VITE_API_BASE_URL` on Vercel.

### Why the API is public, and what the shared key does

The store's server functions run on Vercel, outside Railway, so they can only reach the API over the internet. Railway's private network (`*.railway.internal`) is only for services inside the same Railway project. So the api service needs a public domain.

What protects it:
- **Everything private needs a sign-in token.** Customer routes need a customer token, admin routes need an admin token with the right permission. Tokens are only handed out at sign-in, and the store keeps them in HttpOnly cookies on its own domain, so the browser never sees them.
- **The Stripe webhook** is only accepted with a valid Stripe signature (made with `STRIPE_WEBHOOK_SECRET`).
- **Sign-in, sign-up, codes, orders and reviews are rate-limited per visitor.**
- **The shared key (`BFF_SHARED_KEY` = Vercel's `BUYNEST_BFF_KEY`)** is how the API knows a request comes from the store's server functions. Only then does it accept the `X-Client-IP` header, the shopper's real address, which the rate limits count. Without the right key every shopper looks like one visitor (Vercel's address) and normal traffic hits "Too many attempts"; with a leaked key, someone could pretend to be many visitors to dodge the limits. So keep it secret, and change it on both sides if it leaks.

- **The API only answers the store.** With `BUYNEST_REQUIRE_BFF_KEY=true` (set above), every `/api/...` request without the shared key gets 403, including the Stripe webhook, which Stripe sends to the store (`https://<store>/api/payments/stripe/webhook`) and the store passes on with the key. Someone who finds the API's address can only reach the health check (`/up`) and product photos (`/storage/...`, which the store shows at `/media/...` anyway). If the key leaks, change it on both sides; until then a leaked key lets someone call the API as the store does, still limited by sign-in tokens and rate limits.

## 7. The worker service

1. Project canvas → **Create → GitHub Repo** → the same repository.
2. Settings:
   - **Service name:** `worker`
   - **Root Directory:** `backend`, same branch.
   - **Railway Config File:** `/backend/docker/railway/worker.json` (no health check, because a worker serves no web pages; restart **always**, because `queue:work` stops by itself after an hour to free memory and must come back).
   - **Networking:** no public domain.
3. **Variables → Raw Editor:** paste the same block as in step 4, and change the first line to `CONTAINER_ROLE=worker`. (Tip: instead of copying secrets three times, you can put them under **Project Settings → Shared Variables** and reference them in each service as `${{shared.APP_KEY}}` and so on.)
4. Deploy. Logs show `[buynest:worker] starting the queue worker`, then a line per job it handles.

It runs `php artisan queue:work --tries=3 --max-time=3600`: each job gets three tries; then it lands in the `failed_jobs` table (`artisan queue:failed` lists them, `artisan queue:retry all` tries again).

## 8. The scheduler service

Same as step 7, with:
- **Service name:** `scheduler`
- **Railway Config File:** `/backend/docker/railway/scheduler.json`
- `CONTAINER_ROLE=scheduler`

It runs `php artisan schedule:work`, which checks `routes/console.php` every minute: `buynest:refresh-price-rules` every minute (catalog price rules start and end on time) and `model:prune` daily (deletes sign-ups never confirmed after 7 days). Logs show a line each time a task runs.

Only the **api** service runs migrations (on every deploy, before it starts serving). If the worker or scheduler start a few seconds earlier on the very first deploy, they may log a missing-table error and restart once; that's harmless.

## 9. Vercel: the store and the admin

The general Vercel notes are in [DEPLOYMENT.md](DEPLOYMENT.md#vercel); these are the exact settings for this setup.

1. Vercel → **Add New → Project** → import the same GitHub repository.
2. **Root Directory:** `frontend`. Framework preset: **Vite** (`frontend/vercel.json` already sets the install command, which also installs `../admin`, the build command and the `dist` output). Keep **"Include files outside the root directory in the Build Step"** on (the default): the build needs `../admin`.
3. **Environment Variables** (tick Production and Preview):

   | Name | Value | Notes |
   | --- | --- | --- |
   | `VITE_API_PROVIDER` | `laravel` | catalog from BuyNest's API |
   | `VITE_ACCOUNTS_BACKEND` | `laravel` | real customer and admin accounts |
   | `VITE_SHOW_LEARNING_LAB` | `false` | hides the `/learn` lab |
   | `VITE_API_BASE_URL` | `https://<api domain>` | the API address from step 6 (also allowed in the page's Content-Security-Policy) |
   | `BUYNEST_LARAVEL_URL` | `https://<api domain>` | where the server functions send API calls; no trailing slash |
   | `BUYNEST_BFF_KEY` | the 64-character key from step 1 | **secret**: must equal Railway's `BFF_SHARED_KEY`; mark it Sensitive |

   `VITE_*` values are baked into the pages at build time (and also read by the server functions), so after changing one, **redeploy** on Vercel. The two `BUYNEST_*` variables are only read by the server functions and never reach the browser.
4. **Deploy.** You get an address like `https://buynest.vercel.app` (or add your own domain under **Settings → Domains**).

## 10. Tell the API where the store is

Back in Railway, set `STOREFRONT_URL=https://<your store domain>` on **all three** services (api, worker, scheduler), with no trailing slash. Railway redeploys them. (If you use Shared Variables, change it once there.)

Whenever the store's address changes (for example when you add your own domain), update `STOREFRONT_URL` again and the Stripe webhook URL (step 11).

## 11. Stripe: keys and webhook

Do this in **test mode** first (the toggle in Stripe's dashboard). Test mode never moves real money.

1. Stripe dashboard → **Developers → API keys** → copy the **Secret key** (`sk_test_…`) into `STRIPE_SECRET_KEY` on the Railway services.
2. **Developers → Webhooks** (newer dashboards: **Workbench → Webhooks**, "Add destination") → **Add endpoint**:
   - **Endpoint URL:** `https://<your store domain>/api/payments/stripe/webhook` (the **store's** address on Vercel, not the API's: the store forwards the webhook to the API with the body unchanged).
   - **Events:** `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`. Only these three.
   - Save.
3. On the new endpoint's page → **Signing secret → Reveal** → copy `whsec_…` into `STRIPE_WEBHOOK_SECRET` on the Railway services. Railway redeploys.
4. Check: `https://<api domain>/api/v1/store` now says `"card_payments": "stripe"`.

**Going live later:** switch Stripe to live mode, create a **new** webhook endpoint there (live has its own signing secret), and replace both `STRIPE_SECRET_KEY` (`sk_live_…`) and `STRIPE_WEBHOOK_SECRET`. Test and live keys never mix.

## 12. Create the first admin and import the catalog

The first admin can only be made from the server's command line (the store can't create admins). Railway gives you a shell inside the running api container:

1. Install the Railway CLI on your computer: `npm install -g @railway/cli`, then `railway login`.
2. In the repository folder: `railway link` → pick the project and environment.
3. `railway ssh --service api` (or in the dashboard: right-click the api service → **Copy SSH Command**, and paste it into your terminal).
4. Inside the container, use the `artisan` shortcut (it runs `php artisan` as the app's own user, so files it writes stay usable by the app):
   ```bash
   artisan buynest:create-admin owner@yourdomain.com --name="Your Name"
   # asks for a password: at least 12 characters, letters and numbers. You get the Owner role.

   artisan buynest:import-catalog
   # downloads the demo catalog from dummyjson.com (about 200 products). Safe to run again.

   artisan buynest:mail-test you@yourdomain.com
   # sends one test email right away and prints success or the error (see EMAIL.md)

   exit
   ```

Roles, settings, CMS pages, home content and the demo coupons are created by the migrations; there's no seeding step in production (`db:seed` is for local development only).

## 13. After-deploy checklist

Tick each one, in order:

- [ ] `https://<api domain>/up` shows the "Application up" page; `https://<api domain>/api/v1/nope` answers with a short JSON 404, **no** stack trace (proves `APP_DEBUG=false`).
- [ ] Railway → api → Logs: `serving on port 8080`, no red errors. worker → Logs: `starting the queue worker`. scheduler → Logs: a line every minute for `buynest:refresh-price-rules`.
- [ ] `artisan buynest:mail-test you@yourdomain.com` succeeds and the email arrives (not in spam; if it is, see [EMAIL.md](EMAIL.md#troubleshooting)).
- [ ] The store opens, shows products, and a deep link (`/products/1`) still works after a refresh.
- [ ] **Sign up** with a real address: the 6-digit code arrives within a minute. Confirm, sign out, sign in with "Keep me signed in", reload: still signed in.
- [ ] Browse quickly for a minute: no "Too many attempts" (if you get them, `BUYNEST_BFF_KEY` and `BFF_SHARED_KEY` don't match).
- [ ] **Admin:** `https://<store>/admin/` → sign in with the owner from step 12 → the dashboard loads.
- [ ] **Photo upload persists:** in the admin, open a product → upload a photo → it shows on the store at `/media/products/…`. Then Railway → api → **Redeploy**; once it's back, the photo is still there.
- [ ] **Card order:** add to cart → checkout → pay by card → "Continue to secure payment" → Stripe's page. Card `4242 4242 4242 4242`, any future date, any 3-digit CVC, any name/postcode. You return to "Payment received — thank you"; within seconds the order shows **Paid by card**, an invoice email arrives, and Stripe → Webhooks → your endpoint shows the event answered **200**.
- [ ] **Cancelled payment:** start another card order, click Stripe's back arrow → "Payment not completed" with **Pay now**, which opens Stripe again.
- [ ] **Refund:** in the admin, create a credit memo for the paid order → Stripe's dashboard shows the refund on that payment.
- [ ] **Newsletter (worker):** subscribe in the store's newsletter form with your own address and confirm the email; then send a campaign from the admin's newsletter campaigns page while you're the only subscriber. The worker's log shows the batch job, and the email arrives. (A campaign's **Send test** goes straight to you without the queue, so it doesn't prove the worker runs.)
- [ ] **Backups** are on for the MySQL volume and the photo volume.

## Everyday operations

| Task | How |
| --- | --- |
| Deploy a change | Push to the deployed branch. Railway rebuilds the three services (only when `backend/` changed); Vercel rebuilds the store. Migrations run automatically on the api service. |
| Change a variable | Edit it in Railway → the service redeploys (configuration is cached at start-up, so a redeploy is how it takes effect). On Vercel, redeploy after changing a `VITE_*` value. |
| See errors | Railway → service → **Logs** (Laravel logs to stderr). Vercel → project → **Logs** for the server functions. |
| Run an artisan command | `railway ssh --service api`, then `artisan <command>`. |
| Roll back | Railway → Deployments → an older deployment → **Redeploy**. Migrations don't roll back by themselves; a release that changed tables may need `artisan migrate:rollback` first (check before you do it on live data). |
| Busier shop | Raise the api service's resources in Railway, then `PHP_FPM_MAX_CHILDREN` (about 1 per 60 MB of memory you give it). Keep one replica: the photo volume can only be attached to one container. |

## How the image works (for the curious)

- **`backend/Dockerfile`**: the official `php:8.4-fpm` image (Debian 13) with the extensions BuyNest uses (`pdo_mysql`, `bcmath`, `intl`, `zip`, `exif`, `pcntl`, `opcache`), nginx, and `composer install --no-dev --optimize-autoloader`. PHP settings in `backend/docker/php/` (uploads up to 10 × 5 MB per request, 60 MB per request; OPcache on).
- **Why nginx + PHP-FPM:** it's the standard, battle-tested way to run Laravel. nginx serves photos under `/storage/...` straight from disk and hands everything else to PHP-FPM, which keeps a pool of PHP workers. `php artisan serve` is a single-process development server and isn't meant for production. The two programs run side by side in one container under a small supervisor written in the start script (`backend/docker/start.sh`): if either stops, the container exits and Railway restarts it.
- **`backend/docker/start.sh`**: fixes the volume's owner, switches to `www-data`, caches config, routes and views, and then, depending on `CONTAINER_ROLE`: `web` runs `migrate --force`, `storage:link`, writes nginx's config with `$PORT` and starts serving; `worker` runs `queue:work`; `scheduler` runs `schedule:work`.
- **HTTPS:** Railway handles the certificate. nginx tells Laravel the original request was HTTPS (from Railway's `X-Forwarded-Proto` header), so generated links use `https://`.
- **Build it locally** (needs Docker): `docker build -t buynest-api backend`, then for example `docker run --rm buynest-api php -m`.

# Real email for BuyNest: Brevo or Mailgun

BuyNest sends sign-up and password-reset codes, order emails (confirmation, invoice, shipment, cancellation, refund), newsletters and cart reminders. On a developer's computer they land in the local test inbox (`/dev/mailbox`). In production they go out through an email provider over **SMTP**, the standard protocol for sending mail. Laravel's built-in SMTP mailer does it, so no code changes: you only set the `MAIL_*` variables.

Pick **one** provider:

| | Brevo | Mailgun |
| --- | --- | --- |
| Free tier | yes, with a daily sending limit | trial/free plan with a low daily limit; paid plans for volume |
| SMTP host | `smtp-relay.brevo.com` | `smtp.mailgun.org` (EU accounts: `smtp.eu.mailgun.org`) |
| SMTP login | the SMTP login Brevo shows (looks like `8a1b2c001@smtp-brevo.com`) | `postmaster@mg.yourdomain.com` |
| SMTP password | an **SMTP key** you generate | the SMTP password for that login |
| Good for | small shops, simple dashboard | developers, detailed logs, EU region |

Limits and prices change; check each provider's pricing page.

**Where the variables go:** on Railway, in the **api**, **worker** and **scheduler** services (see [DEPLOY_RAILWAY.md](DEPLOY_RAILWAY.md#4-variables-for-the-api-service)). Locally, in `backend/.env`.

---

## Before you start: a domain you control

Emails must come **from** an address on a domain you own (for example `no-reply@yourdomain.com`), and you must be able to add DNS records for it (at your registrar or DNS host: Cloudflare, Namecheap, GoDaddy, Route 53 …). Addresses on free mailboxes (`@gmail.com`, `@outlook.com`) can't be used as the sender: receiving servers would reject or bin them.

### The three DNS records, in plain words

Receiving mail servers (Gmail, Outlook …) ask three questions before trusting an email. You answer them with DNS records your provider gives you:

- **SPF** — "Is this server allowed to send for this domain?" A `TXT` record listing the services allowed to send as you, e.g. `v=spf1 include:spf.brevo.com ~all`. **A domain (or subdomain) may have only one SPF record.** If you already have one (say, for Google Workspace), don't add a second: merge them, `v=spf1 include:_spf.google.com include:spf.brevo.com ~all`.
- **DKIM** — "Was this email really signed by that domain, and unchanged on the way?" The provider signs each email with a private key; the record (a `TXT` or `CNAME` under a name like `brevo1._domainkey` or `pic._domainkey.mg`) publishes the matching public key.
- **DMARC** — "What should I do if SPF/DKIM fail, and who gets reports?" One `TXT` record at `_dmarc.yourdomain.com`. Start gentle: `v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com` (deliver everything, send reports). After a few weeks of clean reports you can tighten it to `p=quarantine`. Only **one** DMARC record per domain.

Copy record names and values **exactly** as the provider shows them. Some DNS hosts add your domain to the name automatically: if the provider says `brevo1._domainkey.yourdomain.com` and your DNS host's name field already ends in `.yourdomain.com`, enter just `brevo1._domainkey`. DNS changes usually show up within minutes, sometimes a few hours. On Cloudflare, set `CNAME` records for email to **DNS only** (grey cloud), not proxied.

---

## Option A: Brevo

1. **Create the account:** go to brevo.com → **Sign up free** → confirm your email → fill in the company profile (Brevo asks for it before you can send). New accounts can be reviewed by Brevo before transactional sending is allowed; they email you if they need anything.
2. **Add and verify your domain:** top-right menu → **Senders, Domains & Dedicated IPs** → **Domains** → **Add a domain** → enter `yourdomain.com` → choose to set up the records yourself (or let Brevo do it automatically if it offers your DNS host).
3. **Add the records Brevo lists** at your DNS host. Typically:
   - `TXT` at `yourdomain.com`: `brevo-code:…` (proves you own the domain)
   - DKIM: two `CNAME` records, `brevo1._domainkey` and `brevo2._domainkey`, pointing at Brevo
   - DMARC: `TXT` at `_dmarc` (only if you don't have one yet)
   - SPF, if Brevo asks for it: add `include:spf.brevo.com` to your SPF record

   Back in Brevo, click **Verify** (or **Authenticate this email domain**). Every row should turn green.
4. **Add a sender:** **Senders** tab → **Add a sender** → name `BuyNest`, email `no-reply@yourdomain.com`.
5. **Get the SMTP key:** top-right menu → **SMTP & API** → **SMTP** tab. Note the **SMTP server**, **port** and **Login**. Click **Generate a new SMTP key**, name it `BuyNest Railway`, and copy it right away (it's shown once). This is an *SMTP key*, not an API key: the API keys (`xkeysib-…`) don't work for SMTP.
6. **Variables:**
   ```dotenv
   MAIL_MAILER=smtp
   MAIL_SCHEME=smtp
   MAIL_HOST=smtp-relay.brevo.com
   MAIL_PORT=587
   MAIL_USERNAME=<the SMTP Login, e.g. 8a1b2c001@smtp-brevo.com>
   MAIL_PASSWORD=<the SMTP key>
   MAIL_FROM_ADDRESS=no-reply@yourdomain.com
   MAIL_FROM_NAME=BuyNest
   DEV_MAILBOX=false
   ```

## Option B: Mailgun

1. **Create the account:** go to mailgun.com → **Sign up** → confirm your email. Pick the region now: **US** or **EU** (EU keeps data in Europe; it changes the SMTP host). Until you add a domain, Mailgun only gives a *sandbox* domain that can send to a few addresses you authorize, which is fine for a first try but not for a shop.
2. **Add a sending domain:** **Send → Sending → Domains → Add new domain**. Use a **subdomain**, e.g. `mg.yourdomain.com` (Mailgun recommends it: your main domain's email, like your own mailbox, isn't affected). Keep the default DKIM key length.
3. **Add the records Mailgun lists** at your DNS host. Typically:
   - SPF: `TXT` at `mg` → `v=spf1 include:mailgun.org ~all`
   - DKIM: `TXT` at a name like `pic._domainkey.mg` (the selector varies) → `k=rsa; p=MIG…`
   - MX: `mg` → `mxa.mailgun.org` and `mxb.mailgun.org` (priority 10), so bounces and replies reach Mailgun (recommended)
   - Tracking: `CNAME` at `email.mg` → `mailgun.org` (optional; only for open/click tracking)
   - DMARC: `TXT` at `_dmarc.yourdomain.com` if you don't have one yet (see above)

   Back in Mailgun → the domain → **Verify DNS settings**. Wait until it says verified.
4. **SMTP login:** the domain → **Domain settings → SMTP credentials**. The login `postmaster@mg.yourdomain.com` is there: click **Reset password**, copy it (shown once). You can also **Add new SMTP user** (e.g. `buynest@mg.yourdomain.com`) so the shop has its own password.
5. **Variables:**
   ```dotenv
   MAIL_MAILER=smtp
   MAIL_SCHEME=smtp
   MAIL_HOST=smtp.mailgun.org          # EU region: smtp.eu.mailgun.org
   MAIL_PORT=587
   MAIL_USERNAME=postmaster@mg.yourdomain.com
   MAIL_PASSWORD=<the SMTP password>
   MAIL_FROM_ADDRESS=no-reply@mg.yourdomain.com
   MAIL_FROM_NAME=BuyNest
   DEV_MAILBOX=false
   ```
   `no-reply@yourdomain.com` (without `mg.`) also works and looks nicer: DMARC accepts a signature from a subdomain of the same domain. If emails land in spam with it, switch to the `mg.` address.

---

## What the `MAIL_*` values mean

| Variable | Meaning |
| --- | --- |
| `MAIL_MAILER=smtp` | Send through an SMTP server (instead of `log`, which only writes emails to the log). |
| `MAIL_SCHEME=smtp` + `MAIL_PORT=587` | Connect on port 587 and switch to an encrypted connection (STARTTLS) straight away. For port 465 use `MAIL_SCHEME=smtps`. Older guides say `MAIL_ENCRYPTION=tls`; this Laravel version uses `MAIL_SCHEME` instead. |
| `MAIL_HOST` / `MAIL_USERNAME` / `MAIL_PASSWORD` | The provider's server and your SMTP login. Secrets: only in Railway's variables or `backend/.env`, never committed. |
| `MAIL_FROM_ADDRESS` / `MAIL_FROM_NAME` | What customers see as the sender. The address must be on the verified domain. |
| `DEV_MAILBOX=false` | Turns off the local test inbox. It only ever works with `APP_ENV=local`, but keep it `false` in production anyway. |

**Queue:** order emails and codes are sent while the request runs; newsletter batches go through the queue. In production use `QUEUE_CONNECTION=database` with the **worker** service running ([DEPLOY_RAILWAY.md](DEPLOY_RAILWAY.md#7-the-worker-service)); without a worker, newsletter campaigns never go out.

## Test it

After the variables are set and the services have redeployed, open a shell in the api container (`railway ssh --service api`, see [DEPLOY_RAILWAY.md](DEPLOY_RAILWAY.md#12-create-the-first-admin-and-import-the-catalog)) and run:

```bash
artisan buynest:mail-test you@example.com
```

(`artisan` is the image's shortcut for `php artisan` run as the app's user; on your own computer use `php artisan buynest:mail-test you@example.com` in `backend/`.) It sends one test email through the configured mailer straight away and prints either success or the error, without printing your password. Then:

1. Check the inbox **and** the spam folder.
2. In Gmail, open the email → ⋮ → **Show original**. You want `SPF: PASS`, `DKIM: PASS`, `DMARC: PASS`.
3. Do a real flow: sign up on the store with a fresh address; the code should arrive within a minute.

The provider's dashboard also logs every email (Brevo: **Transactional → Logs**; Mailgun: **Send → Reporting → Logs**): delivered, bounced, or blocked, and why.

## Troubleshooting

| Symptom | Likely cause and fix |
| --- | --- |
| `Connection could not be established` / timeout | Wrong `MAIL_HOST` or `MAIL_PORT`, or outbound SMTP is blocked. Railway has blocked outbound SMTP on its free and trial plans: use the Hobby plan or higher. Try port `2525` (both providers accept it, with `MAIL_SCHEME=smtp`) if 587 is blocked on your network. |
| `Failed to authenticate` / `535 Authentication failed` | Wrong login or password. Brevo: use the SMTP **Login** shown on the SMTP page (not your account email) and an **SMTP key** (not an `xkeysib-` API key). Mailgun: the full `postmaster@mg.yourdomain.com` and its SMTP password (reset it if unsure). Remove stray spaces or quotes in Railway's value. |
| `The "tls" scheme is not supported` | Set `MAIL_SCHEME=smtp` (port 587) or `smtps` (port 465), not `tls`. |
| `Sender … not valid` / `domain not verified` | `MAIL_FROM_ADDRESS` isn't on a verified domain or sender. Verify the domain (all records green) or fix the address. |
| Emails arrive in spam | SPF, DKIM or DMARC not passing ("Show original"). Check the records, wait for DNS, make sure there's only one SPF and one DMARC record. New domains also need a little time to build a reputation: send real, expected emails, not bulk mail, at first. |
| Mailgun: only some addresses receive mail | You're still on the sandbox domain, which only sends to authorized recipients. Use your verified `mg.` domain. |
| `mail-test` works but newsletters never go out | The worker isn't running, or `QUEUE_CONNECTION` isn't `database` on every service. Check the worker's logs; `artisan queue:failed` lists jobs that failed three times. |
| Changing a variable had no effect | Configuration is cached when the container starts. Railway redeploys on variable changes; if you changed `backend/.env` on a server, run `php artisan config:cache` again. |
| Codes still show up in `/dev/mailbox` | That's local development (`APP_ENV=local`, `DEV_MAILBOX=true`). In production both must be off. |

## Moving to the other provider later

Verify your domain with the new provider (you can keep both SPF includes while you switch), change the five `MAIL_HOST`/`MAIL_USERNAME`/`MAIL_PASSWORD`/`MAIL_FROM_ADDRESS`/`MAIL_PORT` values on the three Railway services, run `buynest:mail-test`, and then remove the old provider's DNS records.

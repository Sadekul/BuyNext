# Phase 19 contract: welcome coupon

**Status: built (2026-11-27)** — see the SQA report (Phase 19). Asked by the store owner ("start next steps", after the welcome coupon was recommended): a new customer automatically gets a personal, one-time discount code by email when they create an account and/or confirm their newsletter subscription. The newsletter block may then honestly promise the offer — **only while it is switched on**.

## Ground rules (every builder)

- **Off by default.** With the setting off, everything behaves exactly as today (existing tests and browser suites must pass unchanged). The storefront never promises an offer that isn't switched on.
- **Fair and abuse-resistant:** one welcome code per email address, ever (re-subscribing, deleting and re-creating an account, or switching triggers never issues a second one). Codes go only to **confirmed** addresses: a verified account email, or a newsletter subscription confirmed through its link (or switched on from the account page, whose email is verified). The code works once, only for that email address, optionally only on a first order, and expires.
- Reuse what exists: `Coupon` (usage limits, dates, `problemFor()`), `CouponRedemption`, `Newsletter::confirm()` / `setForCustomer()`, the sign-up verification flow (`CustomerAccounts`), `EmailTemplates` / `EmailTemplateCatalog(Bn)`, `Settings`, `Audit`. Don't copy their logic.
- English + Bangla everywhere a shopper sees it (Bangla digits where the store uses them). Money through `Pricing` / `Currency` (store currency, so "৳100" in a taka store, "$10" in USD).
- No real external calls; never read or edit `.env` / `.env.local`; agents never run state-changing git commands; no 0-byte files; never change or delete `admin@buynest.test`, `customer@buynest.test` (Ava), `shopper2@buynest.test` (Ben), never enable two-step.

## 1. Backend (Laravel)

### Data — migration `2026_11_26_000100_add_welcome_coupons`

- `coupons` gains: `source` string(20) not null default `'staff'` (`staff|welcome`), indexed; `issued_to_email` string(191) nullable, indexed (lower-cased); `first_order_only` bool not null default false.
- New table `welcome_coupon_grants`: `id, email` (string 191, **unique**, lower-cased), `coupon_id` (fk nullable, null on delete), `customer_id` (fk nullable, null on delete), `trigger` (`signup|newsletter`), `created_at`. This row is the "one per email, ever" guard (it outlives a deleted coupon or customer). Model `WelcomeCouponGrant`.

### Coupon rules — `Coupon::problemFor()`

Add two checks (keep the existing order; put these right after the group check):
- `issued_to_email` set: the shopper's email (the customer's email when signed in, else the checkout email) must equal it → else "This code isn't available for your account." When no email is known yet (a guest cart before the email step), skip — the check runs again when the order is placed (confirm that `Checkout` re-validates the coupon with the email; add it if not).
- `first_order_only`: the shopper (customer id or email) has any order that isn't `cancelled` → "This code is for your first order only."
- Both messages translated in `lang/bn.json`.
- Admin coupon endpoints: `source`, `issued_to_email`, `first_order_only` in the admin coupon resource; `first_order_only` editable on staff coupons too (a useful general option). `GET coupons` gains `source` filter (`staff` default when omitted? **No** — keep the current default "all" for API compatibility; the admin app sends `source=staff` itself).

### Settings — `welcome_coupon` (Settings service, defaults)

```
welcome_coupon_enabled: false
welcome_coupon_triggers: ["signup", "newsletter"]   // non-empty subset
welcome_coupon_type: "percent"                      // percent | fixed
welcome_coupon_value: "10"                          // percent 1–90; fixed > 0 and ≤ 100000
welcome_coupon_min_subtotal: null                   // money string or null
welcome_coupon_valid_days: 30                       // 1–365
welcome_coupon_first_order_only: true
```

### Service — `app/Services/WelcomeCoupons.php`

- `offer(): ?array` → null when off, else `{type, value, label ("10% off" / "৳100 off", translated, store currency), min_subtotal (formatted or null), valid_days, first_order_only, triggers}`.
- `grant(string $email, string $trigger, ?Customer $customer = null, ?string $locale = null): ?Coupon` — no-op (null) unless enabled and `$trigger` is on. Inside a transaction: insert the grant row first (unique email; a duplicate means "already granted" → return null without error), then create the coupon: code `WELCOME-` + 6 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (retry on collision), `source = welcome`, `issued_to_email`, `type/value/min_subtotal` from settings, `first_order_only` from settings, `usage_limit = 1`, `usage_limit_per_customer = 1`, `is_active = true`, `starts_at = now`, `ends_at = end of day now + valid_days` (store timezone), `applies_to = all`, `auto_apply = false`, description "Welcome offer for {email}". Store `coupon_id` on the grant. After commit: send `WelcomeCouponMail` (queued like other mails if the project queues them; failures reported, never thrown to the caller). Audit `coupon.welcome_issued` (no admin).
- `forEmail(string $email): ?array` → the customer's welcome code `{code, label, min_subtotal, expires_at, status: active|used|expired}` or null.
- Settings changes never touch codes already issued.

### Hooks (call `grant`, never block the main action)

- Sign-up: when a new customer's email is verified (the moment the account becomes active) → `grant($email, 'signup', $customer, $customer->locale)`.
- Newsletter: `Newsletter::confirm()` success → `grant($subscriber->email, 'newsletter', customer if one has that email, subscriber/customer locale)`; `setForCustomer($customer, true)` → `grant(..., 'newsletter', $customer)`.
- Wrap each call so an exception in granting is reported and the sign-up / confirmation still succeeds.

### Email — `WelcomeCouponMail`

New email template key `welcome_coupon` in `EmailTemplateCatalog` and `EmailTemplateCatalogBn` (editable in Content → Email templates like the others), variables: `{{ customer_name }}` (or "there"/Bangla equivalent), `{{ code }}`, `{{ offer }}` ("10% off"), `{{ min_spend_line }}`, `{{ expires_on }}` (localised date), `{{ shop_url }}`. Subject EN "Your welcome code: {{ offer }} your first order" (adjust wording when not first-order-only), BN equivalent. The code in a prominent box. Language: the customer's / subscriber's locale.

### API

Storefront (`/api/v1`):
- `GET /store` gains `welcome_offer` (the `offer()` shape, or null). Keep the existing keys.
- Signed-in account (the existing "me"/account payload the storefront reads): gains `welcome_coupon` (`forEmail()` shape or null).
- Newsletter confirm endpoint response gains `welcome_coupon_sent: bool` (true when a code was issued by this confirmation).

Admin (`/api/admin/v1`, `marketing` permission used by the existing coupon endpoints — reuse the same permission names):
- `GET marketing/welcome-coupon` → `{data: {settings: {...}, offer: offer()|preview even when off, stats: {issued, used, expired, active}}}`.
- `PUT marketing/welcome-coupon` (partial input) → validated (messages in plain English: "Choose at least one way to earn the code.", "A percentage discount is between 1 and 90.", …) → `{data: same}`; audit `settings.welcome_coupon_updated`.
- `GET marketing/welcome-coupon/codes?status=&search=&page=` → paginated `{code, email, trigger, customer: {id, name}|null, issued_at, expires_at, status, used_on_order: number|null}` newest first.

### Tests (feature)

Off → no grant anywhere, `/store` `welcome_offer` null. On: signup grant on verification (not before); newsletter grant on confirm only (not on subscribe); account toggle grant; one per email across triggers, re-subscribe, account deletion and re-creation; trigger subset respected; code format, limits, dates, email; email sent in the right language with the code; `problemFor`: other email refused, guest without email allowed until checkout, first-order-only refused after a non-cancelled order and allowed after only cancelled ones; checkout places an order with the code, the redemption is recorded, a second use refused; admin settings validation, partial PUT, stats and codes list; permissions (403 without the coupon permission); Pint clean.

## 2. Admin app

- **Marketing → Welcome coupon** page (nav item next to Coupons, same permission): an on/off switch with its state in words ("On: new customers get a code" / "Off"); checkboxes "When someone creates an account" and "When someone confirms the newsletter"; discount type (Percentage / Fixed amount) and value with the currency; minimum order (optional); valid for N days; "First order only" checkbox; a live **preview** of what shoppers will see ("Get 10% off your first order", min spend line); Save → "Welcome coupon saved."; stats tiles (Issued, Used, Active, Expired); a table of recent codes (code, email, earned by, issued, expires, status, order link when used) with a status filter and search. Short help text: codes go only to confirmed emails, one per email, changes apply to new codes only.
- **Coupons page:** tabs or a filter "Your coupons" (`source=staff`, default) / "Welcome codes" (`source=welcome`) so personal codes don't flood the list; the coupon form shows "First order only" for staff coupons; a welcome code opened from the list is read-only except Active (to switch one off).
- BFF (`frontend/server`): proxy routes for the new admin endpoints and the new fields, with tests in the existing style.
- Unit tests (`Phase19.test.jsx`): settings validation and payload, preview text, disabled states, codes table and filters, coupons source filter.

## 3. Storefront

- `welcome_offer` from `/store` (pass it through the BFF store mapping — remember the phase 17 `has_sales` lesson: whitelists drop new keys; add a proxy test).
- **Newsletter blocks** (home newsletter band and the footer form): when the offer is on and includes `newsletter`: title "Get {label} your first order" / or "Get {label}" when not first-order-only; text "Confirm your email and we'll send your personal code." (+ "Orders over {min}." when there is a minimum). Otherwise today's honest texts unchanged. Bangla for all.
- **Newsletter confirmation page**: when `welcome_coupon_sent`, "Your welcome code is on its way to your inbox."
- **Sign-up page**: when the offer includes `signup`, a small highlighted note "Create an account and get {label} your first order." (not on sign-in).
- **Account overview**: a "Your welcome code" card when `welcome_coupon` exists: the code (Copy button, `role="status"` result), the offer, minimum, "Use by {date}" (localised), status (Active / Used / Expired; colour never the only signal). Hidden when null.
- Checkout / cart coupon form: the new messages show as the API sends them (already translated).
- Accessible, phone-safe (390px no sideways scroll), tokens only (current palette: emerald + orange).
- Unit tests for each piece (offer on/off, triggers, Bangla, account card states).

## 4. Browser suite `e2e/welcome.mjs` (after `courier` in `run-all.mjs`)

Switches the offer on through the admin page (and puts the settings back in cleanup), then: newsletter band shows the promise; subscribe with a throwaway email → no code yet; confirm via the test inbox link → code email arrives (read it from the dev mailbox) and the confirmation page says so; the code works once at checkout for that email (guest) and is refused for another email and on a second use; sign-up with a new throwaway account → verify → code email in that account's language; account card shows it; first-order-only refusal after an order; admin stats and codes list; switching off removes every promise from the store; axe and 390px on the new pieces; Bangla once. Cleanup deletes the throwaway customers and subscribers it made (never the demo accounts).

## 5. Docs

README row B21, SQA section, LEARNING_LOG, `docs/I18N.md` strings if new glossary words, this contract marked built.

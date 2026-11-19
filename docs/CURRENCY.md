# Store currency: charging in taka (BDT)

BuyNest charges in **one store currency**, set by the deployment, not by an admin
switch. Prices in the database have no currency of their own: `19.99` simply means
"19.99 in the store currency". So changing the currency also means changing every
stored price, and the two must happen together. This page explains how.

## What the setting does

| Variable | Meaning |
| --- | --- |
| `BUYNEST_CURRENCY` | ISO 4217 code, default `USD`. Known formats: `USD $`, `BDT ৳`, `EUR €`, `GBP £`, `INR ₹`, `CAD CA$`, `AUD A$` (2 decimals, symbol before the amount: `৳1,250.00`). |

With `BUYNEST_CURRENCY=BDT`:

- The storefront, the admin, emails, PDFs and reports write money as `৳1,250.00`
  (`GET /api/v1/store` → `currency: { code, symbol, decimals }`).
- **Stripe** charges in taka (Stripe supports BDT). `STRIPE_CURRENCY` no longer exists.
- **PayPal** is unavailable (PayPal doesn't accept BDT): hidden in the store, refused at checkout.
- **SSLCommerz** (bKash, Nagad, Rocket, Upay, cards) works once `SSLCOMMERZ_STORE_ID` and
  `SSLCOMMERZ_STORE_PASSWORD` are set and staff turn it on in Settings → Checkout → payment methods.
- Display currencies (Settings → Currencies) are relative to taka.

**Orders keep their own currency** (`orders.currency`). An order placed in dollars stays in
dollars on its page, invoice, credit memo, PDF and emails after the switch, and reports add
up money per currency (the store currency first, the rest listed separately). Gift cards
keep theirs too: a dollar card can't pay for a taka order.

## Switching an existing store from dollars to taka

You need a maintenance window of a few minutes. Shoppers shouldn't be checking out while
prices change.

1. **Back up the database.**
   ```bash
   php artisan buynest:backup
   ```
   Check that it finished (Admin → System → Backups, or the command's output).

2. **Choose the rate and the rounding.** The rate is how many taka one dollar is worth
   (say `110`). Prices are rounded to whole taka by default; `--round=5` or `--round=10`
   gives tidier prices, `--round=0.01` keeps the paisa. Gift card balances are always
   converted to the paisa, so no customer loses money to rounding.

3. **Set the currency** in the environment (`.env` locally, the service's variables on
   Railway) and reload the configuration:
   ```bash
   BUYNEST_CURRENCY=BDT
   php artisan config:clear   # or config:cache in production
   ```
   From here until step 5 the shop shows dollar amounts with a taka sign, so do steps 3 to 5
   together.

4. **Rehearse with a dry run.** Nothing is saved; it prints how many rows would change and
   a few before/after examples:
   ```bash
   php artisan buynest:currency:convert BDT --rate=110 --dry-run
   ```

5. **Convert for real.**
   ```bash
   php artisan buynest:currency:convert BDT --rate=110 --round=1
   ```
   Everything happens in one database transaction, is recorded in the `currency_conversions`
   table, and appears in the admin's audit log (`currency.converted`).

6. **Clear the caches** so nothing serves old prices:
   ```bash
   php artisan optimize:clear
   ```

7. **Check the shop**: a product page, the cart (free-shipping progress), checkout (shipping
   prices, SSLCommerz offered, PayPal gone), a coupon with a fixed amount, Settings → Shipping
   and Settings → Reward points in the admin, and an old order (still in dollars).

## What the command converts

Multiplied by the rate and rounded to `--round`:

- products: price; gift card products: their fixed amounts and the custom minimum/maximum
- product variants: price (where a variant has its own)
- catalog price rules with a **fixed** amount (percentages stay)
- coupons and cart price rules: fixed amounts and minimum subtotals
- shipping table rates: price and subtotal bands
- settings: standard / express / next-day shipping prices, the free-shipping threshold,
  and the reward point value (kept to 4 decimals, not rounded to `--round`)

Also changed:

- unused gift card balances (and their initial amount) become taka, to the paisa, with a
  transaction note on each card ("Currency changed: 25.50 USD → 2805.00 BDT (rate 110).")
- saved carts' subtotals (used by cart reminder emails)
- display currency rates (divided by the rate, so they stay right relative to taka); a
  display currency equal to the new store currency is switched off

**Never touched:** orders, their items, invoices, credit memos, refunds, payment records,
gift card and reward point history, reports. They are history and keep their own currency.

## Safety rules

- The command refuses to run unless `BUYNEST_CURRENCY` already equals the target, so the code
  and the data always change together.
- It refuses a second run for the same target currency (the prices would be multiplied
  twice). If a conversion went wrong, restore the backup from step 1 instead of converting back.
- `--from` names the currency the prices are in now. By default it is the last conversion's
  target, or `USD` when there was none.

## Development

The local development database stays in dollars (the browser suites expect it). The tests
cover taka with their own data (`tests/Feature/StoreCurrencyTest.php`,
`tests/Feature/SslCommerzPaymentTest.php`). The browser suite `e2e/taka.mjs` runs its own API
with `BUYNEST_CURRENCY=BDT` and a stand-in SSLCommerz.

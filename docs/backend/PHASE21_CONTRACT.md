# Phase 21 contract: sales and cash reports

**Status: built (2026-11-28)**, approved with the proposed answers to Q1–Q5 below ("you should start next phase"). Changes made while building are written into the sections below (who has the cash when staff record it, returned parcels not "still to collect", the `fees_more_than_collected` note, the time zone in the public store info); see [SQA_REPORT.md](../SQA_REPORT.md) "Phase 21". Asked by the store owner ("ok, you can start", after sales and cash reports were recommended). In a cash-on-delivery store most money is not in the shop's account on the day of the sale: it is with a courier, with a delivery person, or still owed by the customer. This phase answers four questions from data the store already records, plus one small new record:

1. **How did we sell?** Orders and revenue per day, week or month, split by payment method and delivery zone.
2. **What money came in?** Payments received per day, by channel (online through each provider, cash collected by each courier, cash collected by staff), and refunds paid out.
3. **Where is the cash?** Per courier: cash it collected for us, its fees, what it has paid us, and what it still owes us.
4. **What is still to collect?** Cash-on-delivery orders shipped but not yet collected, and parcels returned or cancelled.

New record: **courier payments received**. Couriers such as Steadfast and Pathao pay the collected cash minus their fees to the shop every few days. Staff record each payment, which makes "still with the courier" possible.

## Decisions for the owner (approved as proposed)

| # | Question | Proposed |
|---|---|---|
| Q1 | Store time zone for reports (today they use UTC; Dhaka is UTC+6, so "today" starts at 6 a.m.) | New setting **Settings → General → Time zone**, default **UTC** (nothing changes until you choose **Asia/Dhaka**) |
| Q2 | Who may see money reports | The existing **View and download reports** permission (Owner and Viewer today) |
| Q3 | Who may record courier payments | New permission **Record courier payments** (`cash.manage`): Owner only by default; can be ticked for other roles |
| Q4 | A courier's fee when it doesn't report one (manual carriers such as RedX) | Shown as "Not reported", never guessed; staff can type the fee into the courier payment instead (below) |
| Q5 | Daily email with yesterday's figures | **Not in this phase** (possible later) |

## Ground rules (every builder)

- **Read-only figures from real records.** No estimates presented as facts. Missing data is shown as missing ("Not reported", "—"), never as 0.
- **No feature switch needed:** the new reports only read. Existing report and dashboard answers keep their fields (new fields are added only). With the time zone left at UTC every existing test and browser suite passes unchanged.
- **Phase 12 currency rule:** totals add up **store-currency** orders only. Other currencies are listed on their own and never added together.
- **Money:** decimals as 2-decimal strings in API answers, through `Pricing`. Courier columns in cents (`*_cents`) are converted at the edge.
- **No real outside calls.** Couriers are not asked for payout data in this phase. Their payout APIs differ and need sandbox checks with the owner's accounts; that is listed as a later step in `docs/BANGLADESH.md`.
- English only in the admin (as today). Nothing changes in the storefront.
- Never read or edit `.env` / `.env.local`; agents never run state-changing git commands; no 0-byte files; never change or delete `admin@buynest.test`, `customer@buynest.test` (Ava), `shopper2@buynest.test` (Ben); never enable two-step sign-in.
- Use the project's PHP and Node (`export PATH="/var/www/Buynest/.tools/bin:$PATH"`), run artisan with `env -u AI_AGENT`, and on the shared dev database only forward `migrate` (never `fresh`, `refresh` or `rollback`).
- Only the lead runs browser suites, one at a time. A suite that changes settings reads them first and puts them back in a `finally` clean-up, so an interrupted run can be cleaned up the same way.
- Browser suites must pass with the development request limits that `./setup.sh` writes, and must not depend on a limit being hit; calls a suite makes to the API directly retry once on 429 after `Retry-After`, as the other suites do.

## 1. Backend (Laravel)

### Time zone

- Setting `store_timezone` (default `UTC`; any PHP `DateTimeZone` identifier, validated with `timezone_identifiers_list()`). It is part of the `general` group in `GET/PATCH settings`. The admin offers a short list first (Asia/Dhaka, UTC) plus every other zone.
- `Reports` and `ReportController::range()` turn `from` / `to` (whole days in the store time zone) into UTC start/end instants (`Reports::bounds()`), and "today" for the default range is today in the store time zone. SQL `WHERE` uses only whole UTC instants; rows are grouped by the local date **in PHP** (today's `date(placed_at)` grouping in SQL moves to PHP). Never use `CONVERT_TZ` with zone names: MySQL's time zone tables may not be loaded. (Backend tests run on MySQL `buynest_test`, app time zone UTC.)
- It applies to every report in `ReportController`, the new reports, and the dashboard revenue chart (`OverviewController::revenueChart`). `meta` gains `timezone`.
- With UTC every answer is exactly as today (tested).
- The public store info (`GET /api/v1/store`) adds `timezone`, so the admin knows the zone on every page, before any report has loaded (report periods and the courier payment date start on the store's today).

### Data: migration `2026_11_28_000100_add_cash_reports`

- `invoices` gains `kind` (string 20, nullable, indexed): `advance` (COD advance paid online), `cod_collection` (cash collected on delivery), `null` (every other invoice). It also gains `collected_via` (string 20, nullable): a `Shipment::CARRIERS` code when a courier reported the collection, `staff` when staff recorded it, `null` for other kinds.
  - Set in `OrderDocuments::recordAdvance()` (`advance`) and `OrderDocuments::collect()` (`cod_collection`). `collect()` gets a new `?string $via = null` parameter: `Couriers::consequences()` passes `$shipment->carrier` (today it passes only the carrier's *label* as `actor`). The staff path in `OrderController` passes the carrier of the order's latest shipment when it is a courier (`Shipment::COURIERS`: steadfast, pathao, redx, paperfly, sundarban), because that courier's rider collected the cash (couriers booked by hand, such as RedX, never report it themselves); otherwise `staff` (the shop's own delivery, or a non-courier carrier). `Invoice` has no `updated_at`; add both columns to its fillable list.
  - **Backfill** existing rows in the same migration:
    - An invoice whose note starts with "Cash collected on delivery" becomes `cod_collection`. It is `collected_via` = the carrier of the order's latest shipment when that shipment is a courier shipment (`steadfast`, `pathao`, `redx`, `paperfly`, `sundarban`), the same rule as new collections; otherwise `staff`. (For rows without an admin the courier shipment must also be `delivered`: `admin_id` is null-on-delete, so a staff collection whose admin was deleted must not count as a courier's by accident.)
    - An invoice whose note starts with "Advance delivery charge" becomes `advance`.
    - Rows that match neither stay `null`.
  - The backfill is reported as a count in the migration output, and the down step drops the columns.
- `courier_payouts`: `id, carrier (string 20, a CARRIERS code), amount (decimal 12,2, > 0), fees (decimal 12,2, nullable: what the courier says it kept, for couriers that don't report fees per parcel), currency (char 3, store currency at creation), received_on (date, in the store time zone), reference (string 100, nullable: bank / bKash transaction id), note (string 500, nullable), admin_id (fk admins, null on delete), created_at, updated_at, deleted_at (soft delete: a mistake is removed, not edited away)`. Index `(carrier, received_on)`. Model `CourierPayout`. Audit `courier_payout.created|updated|deleted`.

### Permission

- `cash.manage` ("Record courier payments") in `Permissions::GROUPS` (new group `cash`). It is not seeded to any non-system role; Owner has it automatically. Add the admin label.

### Reports (`/api/admin/v1/reports/…`, `reports.view`; `from`, `to`, `group_by` as today)

- `GET reports/sales` keeps its shape and **adds**:
  - `by_payment_method: [{method, label, orders, gross, refunds, net}]`. The method is `orders.payment_method`, except orders whose `payment_method` is `sslcommerz`, which use the wallet or card from `payment_details` (`sslcommerz:bkash`, `sslcommerz:nagad`, `sslcommerz:card`, `sslcommerz:other`, …). `SslCommerzPayments::methodLabel()` returns display labels ("bKash", "Visa card"), so add a sibling `methodCode()` for the codes; a COD order whose advance went through SSLCommerz stays `cod`. It is ordered by gross, descending.
  - `by_delivery_zone: [{zone_code|null, name, orders, gross, refunds, net}]`, with `null` meaning "No zone (outside Bangladesh or a free-text address)".
  - Both are store currency only and add up to `totals` (tested).
- `GET reports/payments` (**money received**, by the day it arrived = `invoices.created_at` in the store time zone):
  - `totals {received, online, cod_cash, other, refunds, net_received}`
  - `channels: [{channel, label, amount, count}]`. The channels are:
    - each online provider (`stripe`, `paypal`, `sslcommerz:bkash`…)
    - `advance` (COD advances paid online)
    - `cash:{carrier}` for each courier that collected cash (for example `cash:steadfast`)
    - `cash:staff`
    - `gift_card` / `reward_points` (amounts paid with them)
    - `other` (staff invoices with no provider)
  - `series [{period, online, cod_cash, other, refunds, net_received}]`, zero-filled
  - `refunds` = credit memo totals by `credit_memos.created_at`. Store currency only, with `other_currencies` as in sales.
- `GET reports/cod` (**cash on delivery and couriers**):
  - `period {shipped, delivered, returned, cancelled, collected, fees, payouts}` per carrier for the range. Counts come from COD shipments by their latest `shipment_events` / status, and money from `invoices.kind = cod_collection` and `courier_payouts.received_on`.
  - `balances: [{carrier, label, collected_all_time, fees_all_time (reported per parcel + entered on payouts; "fees_reported": bool), payouts_all_time, owed (collected − fees − payouts), last_payout_on|null}]`. Balances are **all time, not limited by the range**, and carriers with nothing are left out.
  - `outstanding {orders, amount}`: COD orders shipped and not cancelled with `cod_due > 0`, the shop's whole exposure. A parcel that came back (latest shipment `returned`, or `cancelled` by the courier) is left out: it brings in no cash (it is counted as returned or cancelled instead).
  - `staff {collected}` for the range.
  - A negative `owed` is shown as it is, with a note: `"paid_more_than_recorded"` when payments were recorded (the courier paid more than the cash recorded for it), `"fees_more_than_collected"` when none were (its fees, returned parcels included, are more than the cash it collected: the shop owes it the difference).
- `GET reports/cod/outstanding?carrier&older_than_days&page`: a paginated list of COD orders still to collect: `{number, placed_at, shipped_at, carrier, consignment_id, delivery_status, cod_due, days_since_shipped}`, oldest first.
- CSV: `reports/payments.csv`, `reports/cod.csv` (one row per carrier balance) and `reports/cod/outstanding.csv`, through `Csv::download(..., bom: true)` (the existing report CSVs have no BOM; leave them as they are).

### Courier payments (`/api/admin/v1/courier-payouts`)

- `GET` (`reports.view`; filters `carrier, from, to, page`) → `{id, carrier, carrier_label, amount, fees, currency, received_on, reference, note, admin_name, created_at}`.
- `POST` (`cash.manage`): `amount > 0` with at most 2 decimals, `received_on` not in the future (store time zone) and not before 2020, `carrier` must be a courier code, `reference` / `note` optional. It returns 422 with plain messages. A **duplicate warning**: the same carrier, amount and date as an existing payout answers 409 `{duplicate_of}` unless `confirm_duplicate: true`.
- `PATCH /{id}` and `DELETE /{id}` (`cash.manage`, soft delete). Each is audited with before and after values.

### Tests (feature)

- **Time zone:**
  - UTC gives unchanged answers.
  - Asia/Dhaka moves an order placed at 20:00 UTC to the next day.
  - Range edges, week and month periods.
- **Sales breakdowns:**
  - They add up to the totals.
  - The SSLCommerz wallet split.
  - No zone.
  - Other currencies kept out.
- **Payments:**
  - Each channel.
  - An advance plus a collection on one order counted once each.
  - Refunds.
  - Zero-filled periods.
- **COD:**
  - A courier collection (through `Couriers::apply` with `Http::fake()`) is marked `cod_collection` / `steadfast`.
  - A staff collection is marked `staff`.
  - Fees reported versus not.
  - Payouts reduce `owed`; a negative balance is noted.
  - Outstanding lists only shipped, unpaid COD orders.
  - Returned and cancelled counts.
- **Backfill migration** on seeded rows (both note forms, courier versus staff).
- **Payouts:** validation, duplicate 409 and confirm, soft delete leaving the balance, permissions (`reports.view` without `cash.manage` gets 403 on write), audit.
- **CSV:** headers, BOM, injection guard.
- Pint clean.

## 2. Admin app (and its sign-in service routes in `frontend/server`)

- **Reports page** (existing): the header says the time zone ("Dates in Asia/Dhaka time") instead of "in UTC dates". It gains two sections under Sales: **By payment method** and **By delivery zone**. Each is a table plus simple horizontal bars, with "Show the numbers as a table" as in `NetChart`.
- **Navigation:** Reports is a single sidebar entry today; it becomes a **Reports** group (Sales and products `/reports` with `end: true`, Money in, Cash on delivery, Courier payments). The admin's `reports.view` label becomes "View and download reports", as in the API.
- **New page "Money in"** (`/reports/payments`, Reports group, `reports.view`):
  - Tiles: received, online, cash on delivery, refunds, net received.
  - A stacked daily bar chart (online / cash / other), hand-made like `NetChart`, with a text summary and a data table.
  - A channels table and a CSV download.
- **New page "Cash on delivery"** (`/reports/cod`, `reports.view`):
  - **Courier balances** cards:
    - "Steadfast owes you ৳12,340", with Collected, Fees and Paid to you.
    - Last payment date.
    - "Fees not reported" when unknown.
    - A plain "Paid more than recorded — check the payments" when the balance is negative.
  - The period table per courier (shipped / delivered / returned / collected / fees / payouts).
  - **Still to collect** list with filters (courier, older than 7/14/30 days) linking to each order.
  - CSV downloads.
- **Courier payments** (`/reports/courier-payments`, list `reports.view`, write `cash.manage`):
  - A list with filters.
  - **Record a payment** dialog: courier (every courier in the admin's carrier list: Steadfast, Pathao, RedX, Paperfly, Sundarban), amount, fees kept (optional), date received, reference, note.
  - A duplicate confirmation step (dialog step `form` → `duplicate`, then the same POST with `confirmDuplicate: true`). The 409 `duplicate_of` must survive both hops: the sign-in service's `failed()` drops unknown fields today, and the admin's `ApiError` keeps no extra data; pass it as `duplicateOf` in both, with a proxy test.
  - Edit and Delete with confirmation.
  - Each change is announced ("Payment of ৳9,800 from Steadfast recorded.").
- **Settings → General:** a Time zone select (Asia/Dhaka and UTC first).
- Roles page: the new permission label. Pages and buttons are hidden without permission, with a friendly 403 as today.
- Sign-in service: proxy routes and camelCase mapping for every new endpoint and field. `by_payment_method` and `by_delivery_zone` on the existing sales report go in `REPORT_MAPS`; `timezone` arrives in `meta`, so it goes in `rangeOf()` (→ `range.timezone`) for every report; `store_timezone` goes in `SETTINGS.general` and `SETTING_RULES.general`. The new endpoints (three-segment paths such as `reports/cod/outstanding`, and courier payouts) live in a new `adminPhase21Api.js` + `shop/adminPhase21.js`, matched first in `matchRoute`, as phases 11 and 20 did. Proxy tests (`api.adminPhase21.test.js`) for each mapping, because a field missing from an allow-list was lost before (phase 17).
- Accessibility: every chart has a text summary and a table; money is read with its currency; it works at 390 px wide.
- Unit tests `Phase21.test.jsx` (pages, dialog validation, duplicate step, permissions, negative balance, "Not reported").

## 3. Storefront

No change.

## 4. Browser suite `e2e/reports.mjs` (after `sms` in `run-all.mjs`)

- Like `courier.mjs`, it starts its **own** servers (the usual API has no courier set up, and taka comes from `BUYNEST_CURRENCY=BDT` on the suite's API): a Steadfast stand-in on port 12161, an API on 8015 and a storefront dev server on 5185 (ports 8010–8014, 5180–5184 and 12111–12152 are taken). It refuses busy ports and stops everything it started, also on Ctrl+C.
- It uses its own throwaway products and customer.
- It places COD orders with Bangladeshi addresses (the store's settings are read at the start and put back, as `delivery.mjs` does):
  - one collected by staff
  - one booked and delivered through the courier stand-in from `courier.mjs` (reuse its approach), reporting collected cash and a fee
  - one shipped and not yet collected
  - one returned
- It also places one online-paid order through an existing stand-in, if practical; otherwise the order is invoiced by staff.
- It checks:
  - sales by method and zone
  - Money in (channels add up)
  - the Cash on delivery page (balance = collected − fees)
  - recording a courier payment, including the duplicate warning, and the balance going down
  - edit and delete
  - Still to collect showing the right order
  - CSV downloads (BOM, rows)
  - a Viewer can see but not record
  - the time zone: Asia/Dhaka moves a late-evening UTC order to the next day, then the setting is put back
- It runs axe and checks 390 px on the three new pages.
- **Cleanup:** payouts it made are removed, settings are put back, the customer and products are removed, and stock is restored (orders stay, as in other suites).

## 5. Docs

- `docs/BANGLADESH.md`: a "Cash reports and courier payments" section covering how to reconcile with a courier's payment statement, why fees can be "Not reported", and setting the time zone to Asia/Dhaka. Later step: pulling payout statements from the courier APIs after sandbox checks.
- README row B25, SQA section, LEARNING_LOG, this contract marked built.

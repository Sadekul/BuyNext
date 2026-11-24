# Bangladesh delivery and cash on delivery

Phase 14 makes delivery work the way Bangladeshi online shops do: structured addresses
(division → district → area), Bangladeshi mobile numbers, delivery zones with their own charges and
delivery times, cash on delivery (COD) with a fee, a limit, an advance delivery charge and phone
confirmation, packing slips and a courier CSV. Nothing needs an outside account. API details:
`docs/backend/PHASE14_CONTRACT.md` ("Implementation notes — backend").

**Nothing changes until you switch it on.** With the defaults (no default country, COD fee 0, no limit,
no advance, COD everywhere, no confirmation, no zone rates) the store behaves exactly as before.

## Places

- Source: `backend/database/data/bd-geo/` ([nuhil/bangladesh-geocode](https://github.com/nuhil/bangladesh-geocode), MIT; licence kept there):
  8 divisions, 64 districts, 495 upazilas (English and Bangla names), 12 city corporations, 1,349 post offices.
- Tables `bd_divisions`, `bd_districts`, `bd_areas`. An *area* is an upazila (ids 1–495, the dataset's) or a metro
  **thana** of a city corporation (ids 1001 up, see below). Each area has the postcodes of its post offices.
- Loaded by `php artisan db:seed --class=BangladeshPlacesSeeder` (safe to run again: rows are upserted by id), which the
  migration `2026_11_23_000200_create_bangladesh_places` also runs.
- Public lists for the address form: `GET /api/v1/places/bd/divisions`, `…/districts?division=`, `…/areas?district=`,
  names in the shopper's language, cached for a day.

### Bangla thana names (please review)

The dataset has metro thanas in English only. BuyNest wrote these Bangla names; a Bangla speaker should check them
(fix them in `BangladeshPlacesSeeder::THANA_NAMES`, then run the seeder again). Only 18 metro thanas are in the dataset
(17 in Dhaka, 1 in Khulna); BuyNest adds the other 32 Dhaka Metropolitan Police thanas (table below; fix those in
`backend/database/data/bd-geo/dhaka-metro-thanas.json`). Other cities' areas are covered by their upazila or district.

| id | English | Bangla | City corporation | Postcodes |
|---|---|---|---|---|
| 1001 | Palton | পল্টন | Dhaka South City Corporation | 1000 |
| 1002 | Sutrapur | সূত্রাপুর | Dhaka South City Corporation | 1100, 1203, 1204 |
| 1003 | New Market | নিউ মার্কেট | Dhaka South City Corporation | 1205 |
| 1004 | Mohammadpur | মোহাম্মদপুর | Dhaka North City Corporation | 1207, 1225 |
| 1005 | Dhanmondi | ধানমন্ডি | Dhaka South City Corporation | 1209 |
| 1006 | Lalbag | লালবাগ | Dhaka South City Corporation | 1211 |
| 1007 | Gulshan | গুলশান | Dhaka North City Corporation | 1212, 1213 |
| 1008 | Sabujbag | সবুজবাগ | Dhaka South City Corporation | 1214 |
| 1009 | Tejgaon | তেজগাঁও | Dhaka North City Corporation | 1215 |
| 1010 | Mirpur | মিরপুর | Dhaka North City Corporation | 1216 |
| 1011 | Ramna | রমনা | Dhaka South City Corporation | 1217 |
| 1012 | Khilgaon | খিলগাঁও | Dhaka South City Corporation | 1219 |
| 1013 | Motijheel | মতিঝিল | Dhaka South City Corporation | 1222, 1223 |
| 1014 | Khilkhet | খিলক্ষেত | Dhaka North City Corporation | 1229 |
| 1015 | Uttara | উত্তরা | Dhaka North City Corporation | 1230 |
| 1016 | Jatrabari | যাত্রাবাড়ী | Dhaka South City Corporation | 1232 |
| 1017 | Demra | ডেমরা | Dhaka South City Corporation | 1360, 1361, 1362 |
| 1018 | Khulna Sadar | খুলনা সদর | Khulna City Corporation | 9000, 9100, 9201, 9202, 9203, 9204, 9205, 9206, 9207, 9208 |

**Added by BuyNest (2026-11-24):** the dataset has only 17 of the Dhaka Metropolitan Police thanas, so shoppers in Banani, Badda, Wari and others couldn't choose their area. These 32 come from `backend/database/data/bd-geo/dhaka-metro-thanas.json` (ids 1101–1132, Inside Dhaka zone, no postcodes; Uttara East and West are covered by Uttara). Please review the Bangla names too.

| id | Thana | Bangla (please review) | City corporation |
|---|---|---|---|
| 1101 | Shahbag | শাহবাগ | Dhaka South City Corporation |
| 1102 | Shahjahanpur | শাহজাহানপুর | Dhaka South City Corporation |
| 1103 | Mugda | মুগদা | Dhaka South City Corporation |
| 1104 | Kotwali | কোতোয়ালী | Dhaka South City Corporation |
| 1105 | Wari | ওয়ারী | Dhaka South City Corporation |
| 1106 | Gendaria | গেন্ডারিয়া | Dhaka South City Corporation |
| 1107 | Shyampur | শ্যামপুর | Dhaka South City Corporation |
| 1108 | Kadamtali | কদমতলী | Dhaka South City Corporation |
| 1109 | Chawkbazar | চকবাজার | Dhaka South City Corporation |
| 1110 | Bangshal | বংশাল | Dhaka South City Corporation |
| 1111 | Kamrangirchar | কামরাঙ্গীরচর | Dhaka South City Corporation |
| 1112 | Hazaribagh | হাজারীবাগ | Dhaka South City Corporation |
| 1113 | Kalabagan | কলাবাগান | Dhaka South City Corporation |
| 1114 | Banani | বনানী | Dhaka North City Corporation |
| 1115 | Badda | বাড্ডা | Dhaka North City Corporation |
| 1116 | Vatara | ভাটারা | Dhaka North City Corporation |
| 1117 | Bimanbandar | বিমানবন্দর | Dhaka North City Corporation |
| 1118 | Dakshinkhan | দক্ষিণখান | Dhaka North City Corporation |
| 1119 | Uttarkhan | উত্তরখান | Dhaka North City Corporation |
| 1120 | Turag | তুরাগ | Dhaka North City Corporation |
| 1121 | Pallabi | পল্লবী | Dhaka North City Corporation |
| 1122 | Shah Ali | শাহ আলী | Dhaka North City Corporation |
| 1123 | Rupnagar | রূপনগর | Dhaka North City Corporation |
| 1124 | Kafrul | কাফরুল | Dhaka North City Corporation |
| 1125 | Bhashantek | ভাসানটেক | Dhaka North City Corporation |
| 1126 | Cantonment | ক্যান্টনমেন্ট | Dhaka North City Corporation |
| 1127 | Darus Salam | দারুস সালাম | Dhaka North City Corporation |
| 1128 | Adabor | আদাবর | Dhaka North City Corporation |
| 1129 | Sher-e-Bangla Nagar | শেরেবাংলা নগর | Dhaka North City Corporation |
| 1130 | Tejgaon Industrial Area | তেজগাঁও শিল্পাঞ্চল | Dhaka North City Corporation |
| 1131 | Hatirjheel | হাতিরঝিল | Dhaka North City Corporation |
| 1132 | Rampura | রামপুরা | Dhaka North City Corporation |

## Addresses and mobile numbers

- A **Bangladesh address** has country `Bangladesh` (or `BD`). When the store's **default country** is Bangladesh
  (Settings → Checkout → Default country), or when the address sends place ids, it is *structured*: division, district and
  area are required and must belong together, house/road/village is required, the postcode is optional (4 digits; the
  form suggests it when the area has one). The server fills `city` (district) and `state` (division) in English, so
  invoices, emails and exports keep working; orders also keep `division_id`, `district_id`, `area_id` and `area`.
- Without a Bangladeshi default country, free-text Bangladesh addresses (city/state typed) keep working as before.
- **Mobiles**: `01712345678`, `01712-345678`, `+880 1712 345678`, `8801712345678`, `00880…` (Bangla digits too) are all
  stored as `+8801712345678`. Structured addresses need a Bangladeshi mobile (operator prefixes 013–019), because the
  courier calls it. Other countries keep the international format rule.

## Delivery zones and charges

- **Settings → Delivery zones.** Seeded: *Inside Dhaka* (the Dhaka North/South metro thanas), *Dhaka suburbs* (Dhaka
  district's upazilas, Gazipur, Narayanganj), *Outside Dhaka* (the fallback: every other place). Add districts or single
  areas to a zone; a place can be in one zone only. Matching: the zone listing the **area** wins, then the zone listing the
  **district**, then the **fallback** zone. Inactive zones are skipped.
- **Prices are shipping table rates** (Settings → Shipping → Table rates) with a *Delivery zone* and optional delivery
  days (from/up to). Example for Standard: Inside Dhaka 60 (1–2 days), Dhaka suburbs 100 (2–3 days), Outside Dhaka 120
  (3–5 days). A zone row is chosen before country rows and `*` rows; weight and subtotal bands still apply. Without zone
  rows nothing changes. Note the free-shipping threshold (Settings → Shipping) still makes Standard free above it.
- The cart and checkout show the zone and "Delivery in 1–2 days" ("১–২ দিনে ডেলিভারি"); the order keeps the zone and days.

## Cash on delivery

Settings → Payment methods → Cash on delivery:

| Setting | Default | What it does |
|---|---|---|
| Largest order total | none | COD is offered only up to this total (with the COD fee). |
| COD fee | 0 | Added to COD orders (a "Cash on delivery fee" line; refunded with the shipping). |
| Paid in advance | none | *Delivery charge*: the shopper pays the delivery charge + COD fee online (bKash, Nagad, card through SSLCommerz) before the order is prepared; the rest is cash on delivery. Needs SSLCommerz configured and the store currency BDT. |
| Zones | everywhere | COD only in the ticked zones. |
| Confirm by phone | off | New COD orders wait in **Sales → To confirm**. |

- Refused COD (zone, limit) is explained at checkout in both languages, and the API refuses it.
- **Advance**: the order is *pending payment* until SSLCommerz validates the advance, then *processing* and *partly paid*
  with an invoice for the advance. Unpaid advances are cancelled (and restocked) when the SSLCommerz window passes, like
  other SSLCommerz payments. Refunds return up to the advance through SSLCommerz first; the rest is refunded by hand.
- **Collecting the cash**: *Mark as delivered* asks how much the courier collected. The full amount → an invoice for the
  rest, the order is *paid*. Less → an invoice for what came in, the order stays *partly paid* with the rest still to
  collect, a note is required and staff get a notification; record the rest later the same way.
- **Phone confirmation**: call the number (a `tel:` link) from **Sales → To confirm** (oldest first, with the customer's
  previous orders and returns), then *Confirmed* (emails "We've confirmed your order"), *Couldn't reach* (stays in the
  list, the attempt is counted) or *Cancel order* (with a reason; restocks and emails the cancellation). Every call is
  logged on the order. An unconfirmed COD order can't be shipped unless staff tick "ship without confirmation" and give a
  reason (logged and audited).

## Packing slips and the courier CSV

- **Packing slip PDF** (order page, or the grid's bulk action for up to 100 orders): big order number, recipient, mobile,
  full address (also in Bangla when the order was placed in Bangla), items and quantities without prices, the cash to
  collect in large type ("PREPAID: collect nothing" otherwise), delivery zone and days.
- **Courier CSV** (grid bulk action, or `GET /api/admin/v1/orders/export/courier.csv?numbers=…` / the grid filters): UTF-8
  with a byte order mark so Excel shows Bangla. Columns:

| Column | Content |
|---|---|
| `invoice` | Order number (BN-…) — use it as the merchant invoice / reference id |
| `recipient_name` | Name on the shipping address |
| `recipient_phone` | Mobile in the 11-digit local form (01712345678) |
| `recipient_address` | House/road, line 2, area, district, division and postcode (English place names) |
| `district` | District (English) |
| `area` | Upazila or thana (English); empty for free-text addresses |
| `cod_amount` | Cash the rider collects; 0.00 for prepaid orders |
| `weight_kg` | Items' weight (product/variant weight, else the default weight setting) |
| `note` | Delivery zone; "Advance paid N"; "Prepaid" |

### Mapping to a courier's upload

BuyNest doesn't claim ready-made presets for specific couriers yet: each courier's bulk-upload template changes over time
and must be checked with the courier. To upload:

1. Download the courier's current bulk-order template from their merchant panel.
2. Open BuyNest's courier CSV in Excel or Google Sheets, and copy the columns into the template:
   - *Invoice / merchant order id / reference* ← `invoice`
   - *Customer / recipient name* ← `recipient_name`; *phone* ← `recipient_phone` (keep it as text so the leading 0 stays)
   - *Address* ← `recipient_address`; *district / city* ← `district`; *area / zone / thana* ← `area`
     (couriers use their own area lists: pick the matching one when the names differ)
   - *COD / amount to collect* ← `cod_amount`; *weight* ← `weight_kg`; *note / instruction* ← `note`
3. Fill the courier-only fields (delivery type, item type, pickup store) and upload.

If you settle on one courier, a fixed column mapping can be added later as a preset after checking their template.

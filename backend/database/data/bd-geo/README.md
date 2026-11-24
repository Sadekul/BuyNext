# Bangladesh divisions, districts, upazilas, city corporations and postcodes

Source: https://github.com/nuhil/bangladesh-geocode (MIT License, Copyright (c) 2014 Nuhil Mehdy; see LICENSE in this folder).
Downloaded 2026-11-23 from the `master` branch: `divisions/divisions.json`, `districts/districts.json`,
`upazilas/upazilas.json`, `city_corporations/city_corporations.json`, `postcodes/postcodes.json`
(phpMyAdmin JSON export format: the table rows are in the entry that has `data`).

Counts: 8 divisions, 64 districts, 495 upazilas, 12 city corporations, 1,349 post offices
(metro thanas have `link_method: "metro_thana"` and an English name only; their Bangla names are
added by BuyNest and should be reviewed by a Bangla speaker).
Used by the Phase 14 seeder (docs/backend/PHASE14_CONTRACT.md). Data only: nothing here is executed.

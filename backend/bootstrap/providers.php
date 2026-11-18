<?php

use App\Providers\AppServiceProvider;
use App\Providers\LaunchServiceProvider;
use App\Providers\MarketingServiceProvider;
use App\Providers\SearchServiceProvider;

return [
    AppServiceProvider::class,
    MarketingServiceProvider::class, // phase 7 (part B): newsletter limit, notifications, saved carts
    LaunchServiceProvider::class, // phase 9 (part B): stock alerts, error report and stock alert limits
    SearchServiceProvider::class, // Phase 10 (part A): search index and vocabulary kept in step with the catalog
];

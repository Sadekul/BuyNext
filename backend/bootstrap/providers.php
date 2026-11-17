<?php

use App\Providers\AppServiceProvider;
use App\Providers\LaunchServiceProvider;
use App\Providers\MarketingServiceProvider;

return [
    AppServiceProvider::class,
    MarketingServiceProvider::class, // phase 7 (part B): newsletter limit, notifications, saved carts
    LaunchServiceProvider::class, // phase 9 (part B): stock alerts, error report and stock alert limits
];

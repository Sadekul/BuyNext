<?php

use App\Services\Settings;
use Illuminate\Support\Facades\Schedule;

// Deletes sign-ups that never confirmed their email (Customer::prunable).
Schedule::command('model:prune')->daily();

// Phase 7 (part A): catalog price rules start and end on time (the cache is rebuilt when one does).
Schedule::command('buynest:refresh-price-rules')->everyMinute();

// Phase 9 (part B): the daily database backup, at BACKUP_TIME (03:00) in the store's time zone.
// onOneServer: only one container runs it, even if two schedulers are up (the lock is in the shared cache).
if (config('buynest.backups.schedule')) {
    Schedule::command('buynest:backup --trigger=schedule')
        ->dailyAt(config('buynest.backups.time'))
        ->timezone(config('buynest.backups.timezone'))
        ->withoutOverlapping(60)
        ->onOneServer();
}

// Phase 10 (part B): unpaid PayPal orders are cancelled once PayPal's 3-hour approval window has passed
// (PayPal is asked first, so a payment that went through is recorded instead).
Schedule::command('buynest:payments:expire-paypal')->everyFiveMinutes()->withoutOverlapping(10)->onOneServer();

// Phase 12: unpaid SSLCommerz orders are cancelled once their payment window has passed
// (SSLCommerz is asked about every attempt first, so a payment that went through is recorded instead).
Schedule::command('buynest:payments:expire-sslcommerz')->everyFiveMinutes()->withoutOverlapping(10)->onOneServer();

// Phase 10 (part A): the search vocabulary follows catalog changes on its own; this daily
// run also catches anything changed with plain SQL.
Schedule::command('buynest:search:reindex')->dailyAt('04:10')->withoutOverlapping(30)->onOneServer();

// Phase 18: ask the couriers about open parcels (Settings → Couriers → auto-sync; webhooks usually come first).
Schedule::command('buynest:couriers:sync')->everyThirtyMinutes()->withoutOverlapping(20)->onOneServer()
    ->when(fn () => (bool) app(Settings::class)->get('courier_auto_sync', true));

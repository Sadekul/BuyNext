<?php

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

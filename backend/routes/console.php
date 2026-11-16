<?php

use Illuminate\Support\Facades\Schedule;

// Deletes sign-ups that never confirmed their email (Customer::prunable).
Schedule::command('model:prune')->daily();

// Phase 7 (part A): catalog price rules start and end on time (the cache is rebuilt when one does).
Schedule::command('buynest:refresh-price-rules')->everyMinute();

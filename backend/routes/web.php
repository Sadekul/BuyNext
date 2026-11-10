<?php

use App\Http\Controllers\DevMailboxController;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Illuminate\Support\Facades\Route;

Route::get('/', fn () => response()->json(['name' => 'BuyNest API', 'docs' => 'docs/backend/API_CONTRACT.md']));

// Local test inbox: only on a developer's computer, never in production.
if (app()->environment('local') && config('buynest.dev_mailbox')) {
    Route::prefix('dev/mailbox')->controller(DevMailboxController::class)->group(function () {
        Route::get('/', 'index')->name('dev.mailbox');
        Route::get('latest', 'latest');
        Route::delete('/', 'clear')->withoutMiddleware(ValidateCsrfToken::class);
        Route::get('{mail}', 'show')->whereNumber('mail')->name('dev.mailbox.show');
    });
}

<?php

namespace App\Console\Commands;

use App\Services\Payments\PayPalPayments;
use Illuminate\Console\Command;

/**
 * Phase 10 (part B): cancels unpaid PayPal orders whose 3-hour approval
 * window has passed (scheduled every 5 minutes). PayPal is asked first, so a
 * payment completed meanwhile is recorded instead.
 */
class ExpirePayPalPayments extends Command
{
    protected $signature = 'buynest:payments:expire-paypal';

    protected $description = 'Cancel unpaid PayPal orders whose approval window has passed (after checking with PayPal)';

    public function handle(PayPalPayments $payments): int
    {
        $counts = $payments->expireStale();
        $this->info($counts === [] ? 'No expired PayPal payments.'
            : 'Expired PayPal payments: '.collect($counts)->map(fn ($n, $outcome) => "{$outcome} {$n}")->implode(', ').'.');

        return self::SUCCESS;
    }
}

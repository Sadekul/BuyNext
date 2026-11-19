<?php

namespace App\Console\Commands;

use App\Services\Payments\SslCommerzPayments;
use Illuminate\Console\Command;

/**
 * Phase 12: cancels unpaid SSLCommerz orders whose payment window has
 * passed (scheduled every 5 minutes). SSLCommerz is asked about every
 * attempt first, so a payment completed meanwhile is recorded instead.
 */
class ExpireSslCommerzPayments extends Command
{
    protected $signature = 'buynest:payments:expire-sslcommerz';

    protected $description = 'Cancel unpaid SSLCommerz orders whose payment window has passed (after checking with SSLCommerz)';

    public function handle(SslCommerzPayments $payments): int
    {
        $counts = $payments->expireStale();
        $this->info($counts === [] ? 'No expired SSLCommerz payments.'
            : 'Expired SSLCommerz payments: '.collect($counts)->map(fn ($n, $outcome) => "{$outcome} {$n}")->implode(', ').'.');

        return self::SUCCESS;
    }
}

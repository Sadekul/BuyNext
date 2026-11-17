<?php

namespace App\Jobs;

use App\Mail\BackInStockMail;
use App\Models\StockAlert;
use App\Services\StockAlerts;
use App\Support\CategoryTree;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Throwable;

/**
 * Phase 9 (part B): emails up to 100 waiting stock alerts "it's back"
 * (queued, like newsletter batches; with QUEUE_CONNECTION=sync it runs at
 * once). It only carries ids and checks again that each product/variant can
 * still be bought (it may have sold out again while the job waited). Each
 * alert is claimed before its email goes (StockAlerts::claim), so two jobs
 * with the same alert send it once.
 */
class SendStockAlertBatch implements ShouldQueue
{
    use Queueable;

    public const SIZE = 100;

    public int $tries = 1;

    /** @param list<int> $alertIds */
    public function __construct(public array $alertIds) {}

    public function handle(StockAlerts $alerts): void
    {
        $tree = CategoryTree::load();
        $available = [];
        $waiting = StockAlert::with(['product.variants', 'variant'])->whereIn('id', $this->alertIds)->whereNull('notified_at')->orderBy('id')->get();

        foreach ($waiting as $alert) {
            $product = $alert->product;
            if (! $product) {
                continue;
            }
            $target = $product->id.':'.($alert->variant_id ?? 0);
            $available[$target] ??= $alerts->isAvailable($product, $alert->variant_id ? $alert->variant : null, $tree)
                && (! $alert->variant_id || $alert->variant);
            if (! $available[$target]) {
                continue; // stays waiting for the next time
            }
            $token = $alerts->claim($alert->id);
            if ($token === null) {
                continue; // another job sent it
            }
            try {
                Mail::to($alert->email)->send(new BackInStockMail($alert, StockAlerts::unsubscribeUrl($alert, $token)));
            } catch (Throwable $e) {
                Log::warning("Back-in-stock email for alert {$alert->id} failed: {$e->getMessage()}");
            }
        }
    }
}

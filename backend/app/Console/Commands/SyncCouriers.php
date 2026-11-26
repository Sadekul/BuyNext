<?php

namespace App\Console\Commands;

use App\Models\Shipment;
use App\Services\Couriers\CourierException;
use App\Services\Couriers\Couriers;
use Illuminate\Console\Command;

/**
 * Phase 18: asks the couriers about their open parcels (scheduled every 30
 * minutes while Settings → Couriers → auto-sync is on), for couriers whose
 * webhook is missed or not set up. Only API bookings of the last 30 days
 * that aren't finished (delivered, returned, cancelled), least recently
 * asked first, at most --limit (200) per run. A courier that can't be
 * reached is skipped for the rest of the run; the others go on.
 */
class SyncCouriers extends Command
{
    protected $signature = 'buynest:couriers:sync {--dry-run : List the parcels that would be checked, ask no courier} {--limit=200 : At most this many parcels}';

    protected $description = 'Ask Steadfast and Pathao for the status of open courier bookings';

    public function handle(Couriers $couriers): int
    {
        $shipments = Shipment::where('booked_via_api', true)
            ->whereNotIn('delivery_status', Shipment::FINAL_DELIVERY_STATUSES)
            ->whereIn('carrier', array_keys(Couriers::GATEWAYS))
            ->where('created_at', '>=', now()->subDays(30))
            // NULL (never asked) first in MySQL's ascending order.
            ->orderBy('last_synced_at')->orderBy('id')
            ->limit(max(1, min(200, (int) $this->option('limit'))))
            ->get();

        if ($shipments->isEmpty()) {
            $this->info('No open courier parcels to check.');

            return self::SUCCESS;
        }
        if ($this->option('dry-run')) {
            foreach ($shipments as $shipment) {
                $this->line("{$shipment->number}: {$shipment->carrierLabel()} {$shipment->courier_consignment_id} ({$shipment->delivery_status})");
            }
            $this->info("Would check {$shipments->count()} parcels.");

            return self::SUCCESS;
        }

        $counts = ['updated' => 0, 'unchanged' => 0, 'failed' => 0, 'skipped' => 0];
        $down = [];
        foreach ($shipments as $shipment) {
            if (isset($down[$shipment->carrier])) {
                $counts['skipped']++;

                continue;
            }
            $gateway = $couriers->find($shipment->carrier);
            if (! $gateway?->configured()) {
                $down[$shipment->carrier] = true;
                $counts['skipped']++;

                continue;
            }

            try {
                $counts[$couriers->sync($shipment, 'sync') ? 'updated' : 'unchanged']++;
            } catch (CourierException $e) {
                $counts['failed']++;
                $this->warn("{$shipment->number}: {$e->getMessage()}");
                if ($e->unreachable) {
                    $down[$shipment->carrier] = true;
                }
            }
        }

        $this->info("Checked {$shipments->count()} parcels: {$counts['updated']} updated, {$counts['unchanged']} unchanged, {$counts['failed']} failed, {$counts['skipped']} skipped."
            .($down ? ' Not reached or not set up: '.implode(', ', array_keys($down)).'.' : ''));

        return self::SUCCESS;
    }
}

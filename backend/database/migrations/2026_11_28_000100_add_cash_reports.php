<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Phase 21: sales and cash reports (docs/backend/PHASE21_CONTRACT.md).
 *
 * invoices.kind says what an invoice was for: "advance" (the online advance
 * of a cash on delivery order), "cod_collection" (cash collected on
 * delivery) or null (every other invoice). invoices.collected_via says who
 * has the cash: a courier code (Shipment::COURIERS) when the order went with
 * that courier (reported by the courier, or recorded by staff), "staff" for
 * the shop's own delivery, null for other kinds.
 *
 * courier_payouts: the money a courier paid the shop (the cash it collected
 * minus its fees). Staff record each payment, so the reports can say how
 * much is still with each courier. A mistake is deleted (soft), not edited away.
 *
 * Existing invoices are filled in from their notes (backfill()), and the
 * counts are printed.
 */
return new class extends Migration
{
    /** The Bangladeshi couriers (Shipment::COURIERS when this migration was written). */
    private const COURIERS = ['steadfast', 'pathao', 'redx', 'paperfly', 'sundarban'];

    public function up(): void
    {
        Schema::table('invoices', function (Blueprint $table) {
            $table->string('kind', 20)->nullable()->after('amount')->index();
            $table->string('collected_via', 20)->nullable()->after('kind');
        });

        Schema::create('courier_payouts', function (Blueprint $table) {
            $table->id();
            $table->string('carrier', 20);
            $table->decimal('amount', 12, 2);
            $table->decimal('fees', 12, 2)->nullable();
            $table->char('currency', 3);
            $table->date('received_on');
            $table->string('reference', 100)->nullable();
            $table->string('note', 500)->nullable();
            $table->foreignId('admin_id')->nullable()->constrained('admins')->nullOnDelete();
            $table->timestamps();
            $table->softDeletes();
            $table->index(['carrier', 'received_on']);
        });

        $counts = $this->backfill();
        if (! app()->runningUnitTests() && defined('STDOUT')) {
            fwrite(STDOUT, "  Phase 21 backfill: {$counts['cod_collection']} cash collection invoice(s) "
                ."({$counts['courier']} by a courier, {$counts['staff']} by staff), {$counts['reclassified']} moved from staff to a courier, "
                ."{$counts['advance']} advance invoice(s).\n");
        }
    }

    /**
     * Marks the existing invoices; safe to run again (it only fills in what is missing or still "staff"):
     * - "Cash collected on delivery…" → cod_collection. Who has the cash depends on the order's latest shipment:
     *   - no shipment, or the shop's own delivery (other, DHL, …) → staff;
     *   - a courier parcel (Shipment::COURIERS) that staff recorded the cash for (admin_id set) → that courier
     *     (the courier collected it and pays it to the shop);
     *   - no admin (admin_id null): that courier only when the courier reported the parcel delivered, else staff
     *     (admin_id is null-on-delete, so a staff collection whose admin was deleted isn't guessed to be a courier's);
     * - cod_collection rows already marked "staff" that staff recorded are looked at again with the same rule
     *   (rows marked before this rule existed);
     * - "Advance delivery charge…" → advance.
     * Returns { cod_collection, courier, staff, reclassified, advance }: cod_collection = rows newly marked
     * (courier + staff), reclassified = "staff" rows moved to a courier.
     */
    public function backfill(): array
    {
        $counts = ['cod_collection' => 0, 'courier' => 0, 'staff' => 0, 'reclassified' => 0, 'advance' => 0];

        DB::table('invoices')
            ->where(fn ($query) => $query->where(fn ($new) => $new->whereNull('kind')->where('note', 'like', 'Cash collected on delivery%'))
                ->orWhere(fn ($old) => $old->where('kind', 'cod_collection')->where('collected_via', 'staff')->whereNotNull('admin_id')))
            ->select(['id', 'order_id', 'admin_id', 'kind'])
            ->chunkById(500, function ($invoices) use (&$counts) {
                $latest = DB::table('shipments')->whereIn('order_id', $invoices->pluck('order_id')->unique())
                    ->orderBy('id')->get(['order_id', 'carrier', 'delivery_status'])->keyBy('order_id'); // the last one per order wins
                foreach ($invoices as $invoice) {
                    $via = $this->collector($invoice->admin_id, $latest->get($invoice->order_id));
                    if ($invoice->kind === null) {
                        DB::table('invoices')->where('id', $invoice->id)->update(['kind' => 'cod_collection', 'collected_via' => $via]);
                        $counts['cod_collection']++;
                        $counts[$via === 'staff' ? 'staff' : 'courier']++;
                    } elseif ($via !== 'staff') {
                        DB::table('invoices')->where('id', $invoice->id)->update(['collected_via' => $via]);
                        $counts['reclassified']++;
                    }
                }
            });

        $counts['advance'] = DB::table('invoices')->whereNull('kind')->where('note', 'like', 'Advance delivery charge%')
            ->update(['kind' => 'advance']);

        return $counts;
    }

    /** The courier code, or "staff" (see backfill()). */
    private function collector(?int $adminId, ?object $shipment): string
    {
        if ($shipment === null || ! in_array($shipment->carrier, self::COURIERS, true)) {
            return 'staff';
        }

        return $adminId !== null || $shipment->delivery_status === 'delivered' ? $shipment->carrier : 'staff';
    }

    public function down(): void
    {
        Schema::dropIfExists('courier_payouts');
        Schema::table('invoices', function (Blueprint $table) {
            $table->dropIndex(['kind']);
            $table->dropColumn(['kind', 'collected_via']);
        });
    }
};

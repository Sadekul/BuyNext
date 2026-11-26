<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Phase 18: courier bookings (Steadfast, Pathao). A shipment booked through a
 * courier's API keeps the courier's consignment id, its raw status and our
 * normalised delivery_status (Shipment::DELIVERY_STATUSES), the cash it was
 * asked to collect, its fee and what it reports collected. Every status the
 * courier reports (booking, webhook, sync) is a shipment_events row, so
 * staff and customers see the parcel's way.
 *
 * Old shipments get delivery_status "shipped": a manual shipment without
 * courier updates. order_status_history.actor names a system actor
 * ("Steadfast") on steps no staff member took, e.g. a delivery a courier
 * reported.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('shipments', function (Blueprint $table) {
            $table->string('courier_consignment_id', 60)->nullable()->after('tracking_number');
            $table->string('courier_status', 60)->nullable()->after('courier_consignment_id');
            $table->string('delivery_status', 20)->default('shipped')->after('courier_status');
            $table->unsignedInteger('cod_amount_cents')->nullable()->after('delivery_status');
            $table->unsignedInteger('courier_fee_cents')->nullable()->after('cod_amount_cents');
            $table->unsignedInteger('collected_cents')->nullable()->after('courier_fee_cents');
            $table->boolean('booked_via_api')->default(false)->after('collected_cents');
            $table->timestamp('status_updated_at')->nullable()->after('booked_via_api');
            $table->timestamp('last_synced_at')->nullable()->after('status_updated_at');
            // One consignment per courier (NULLs, i.e. manual shipments, don't clash).
            $table->unique(['carrier', 'courier_consignment_id'], 'shipments_carrier_consignment_unique');
            // The sync command: open API bookings, least recently asked first.
            $table->index(['booked_via_api', 'delivery_status', 'last_synced_at'], 'shipments_courier_sync_index');
        });

        Schema::create('shipment_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('shipment_id')->constrained()->cascadeOnDelete();
            $table->string('delivery_status', 20);
            $table->string('courier_status', 60)->nullable();
            $table->string('message', 500)->nullable();
            $table->enum('source', ['booking', 'webhook', 'sync', 'staff']);
            $table->timestamp('occurred_at')->nullable();
            $table->timestamp('created_at')->nullable();
            $table->index(['shipment_id', 'occurred_at']);
        });

        Schema::table('order_status_history', function (Blueprint $table) {
            $table->string('actor', 40)->nullable()->after('admin_id');
        });
    }

    public function down(): void
    {
        Schema::table('order_status_history', function (Blueprint $table) {
            $table->dropColumn('actor');
        });
        Schema::dropIfExists('shipment_events');
        Schema::table('shipments', function (Blueprint $table) {
            $table->dropUnique('shipments_carrier_consignment_unique');
            $table->dropIndex('shipments_courier_sync_index');
            $table->dropColumn(['courier_consignment_id', 'courier_status', 'delivery_status', 'cod_amount_cents', 'courier_fee_cents',
                'collected_cents', 'booked_via_api', 'status_updated_at', 'last_synced_at']);
        });
    }
};

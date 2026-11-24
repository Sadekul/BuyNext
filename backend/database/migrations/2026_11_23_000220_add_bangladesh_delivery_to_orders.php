<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Phase 14: delivery zone and cash on delivery on orders (fee, advance
 * delivery charge, cash still to collect, phone confirmation), the
 * confirmation log, and Bangladesh place ids in the address book.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->string('delivery_zone_code', 40)->nullable()->index();
            $table->unsignedSmallInteger('delivery_eta_min')->nullable();
            $table->unsignedSmallInteger('delivery_eta_max')->nullable();
            $table->decimal('cod_fee', 10, 2)->default(0);
            $table->decimal('advance_amount', 10, 2)->default(0); // to pay online before delivery (delivery charge + COD fee)
            $table->decimal('advance_paid', 10, 2)->default(0);
            $table->decimal('advance_refunded', 10, 2)->default(0); // given back through SSLCommerz
            $table->decimal('cod_due', 10, 2)->nullable(); // cash still to collect (COD orders)
            $table->decimal('cod_collected', 10, 2)->default(0);
            $table->string('confirmation_status', 20)->nullable()->index(); // pending | confirmed | unreachable | cancelled
            $table->unsignedSmallInteger('confirmation_attempts')->default(0);
            $table->timestamp('confirmed_at')->nullable();
        });

        Schema::create('order_confirmation_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('order_id')->constrained()->cascadeOnDelete();
            $table->foreignId('admin_id')->nullable()->constrained('admins')->nullOnDelete();
            $table->string('outcome', 20); // confirmed | unreachable | cancelled | override
            $table->string('note', 1000)->nullable();
            $table->timestamps();
        });

        Schema::table('customer_addresses', function (Blueprint $table) {
            $table->unsignedInteger('division_id')->nullable()->after('country');
            $table->unsignedInteger('district_id')->nullable()->after('division_id');
            $table->unsignedInteger('area_id')->nullable()->after('district_id');
            // A Bangladesh postcode is optional.
            $table->string('postal_code', 10)->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('customer_addresses', fn (Blueprint $table) => $table->dropColumn(['division_id', 'district_id', 'area_id']));
        Schema::dropIfExists('order_confirmation_logs');
        Schema::table('orders', function (Blueprint $table) {
            $table->dropIndex(['delivery_zone_code']);
            $table->dropIndex(['confirmation_status']);
            $table->dropColumn(['delivery_zone_code', 'delivery_eta_min', 'delivery_eta_max', 'cod_fee', 'advance_amount', 'advance_paid',
                'advance_refunded', 'cod_due', 'cod_collected', 'confirmation_status', 'confirmation_attempts', 'confirmed_at']);
        });
    }
};

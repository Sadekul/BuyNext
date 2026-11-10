<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * The documents an order collects after checkout (Magento's model):
 *   invoice      - records the payment ("INV-100001")
 *   shipment     - the parcel left, with carrier and tracking ("SHP-100001")
 *   credit memo  - money given back, per item ("CM-100001")
 * Numbers are 100000 + id, set right after the insert (like orders).
 * customer_notified decides whether the customer may see the staff note.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('invoices', function (Blueprint $table) {
            $table->id();
            $table->string('number', 20)->nullable()->unique();
            $table->foreignId('order_id')->constrained()->cascadeOnDelete();
            $table->decimal('amount', 10, 2);
            $table->foreignId('admin_id')->nullable()->constrained()->nullOnDelete();
            $table->text('note')->nullable();
            $table->boolean('customer_notified')->default(false);
            $table->timestamp('created_at')->nullable();
        });

        Schema::create('shipments', function (Blueprint $table) {
            $table->id();
            $table->string('number', 20)->nullable()->unique();
            $table->foreignId('order_id')->constrained()->cascadeOnDelete();
            $table->string('carrier', 10);
            $table->string('tracking_number', 60)->nullable();
            $table->foreignId('admin_id')->nullable()->constrained()->nullOnDelete();
            $table->text('note')->nullable();
            $table->boolean('customer_notified')->default(false);
            $table->timestamp('created_at')->nullable();
        });

        Schema::create('credit_memos', function (Blueprint $table) {
            $table->id();
            $table->string('number', 20)->nullable()->unique();
            $table->foreignId('order_id')->constrained()->cascadeOnDelete();
            $table->decimal('subtotal', 10, 2);
            $table->decimal('shipping_refund', 10, 2);
            $table->decimal('adjustment', 10, 2); // negative = a fee the shop keeps
            $table->decimal('total', 10, 2);
            $table->boolean('restocked')->default(false);
            $table->foreignId('admin_id')->nullable()->constrained()->nullOnDelete();
            $table->text('note')->nullable();
            $table->boolean('customer_notified')->default(false);
            $table->timestamp('created_at')->nullable();
        });

        Schema::create('credit_memo_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('credit_memo_id')->constrained()->cascadeOnDelete();
            $table->foreignId('order_item_id')->constrained()->cascadeOnDelete();
            $table->unsignedInteger('quantity');
            $table->decimal('amount', 10, 2);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('credit_memo_items');
        Schema::dropIfExists('credit_memos');
        Schema::dropIfExists('shipments');
        Schema::dropIfExists('invoices');
    }
};

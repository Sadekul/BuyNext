<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Phase 10 (part B): gift cards.
 * - gift_cards: the code is stored only as a SHA-256 hash (plus its last 4
 *   characters to show); the balance changes only under a row lock, and every
 *   change is a gift_card_transactions row.
 * - products: type (simple | gift_card) and the amounts a gift card product offers.
 * - order_items.gift_card: the amount and recipient chosen for a gift card line.
 * - orders: the card redeemed and how much it paid; credit_memos: what a refund gave back to it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('gift_cards', function (Blueprint $table) {
            $table->id();
            $table->char('code_hash', 64)->unique();
            $table->char('last4', 4);
            $table->decimal('initial_balance', 10, 2);
            $table->decimal('balance', 10, 2);
            $table->char('currency', 3)->default('USD');
            $table->string('status', 20)->default('active'); // active | disabled | expired
            $table->timestamp('expires_at')->nullable();
            $table->foreignId('purchaser_order_item_id')->nullable()->constrained('order_items')->nullOnDelete();
            $table->string('recipient_email', 190)->nullable();
            $table->string('recipient_name', 120)->nullable();
            $table->text('message')->nullable();
            $table->foreignId('created_by_admin_id')->nullable()->constrained('admins')->nullOnDelete();
            $table->timestamps();
            $table->index('last4');
            $table->index('recipient_email');
        });

        Schema::create('gift_card_transactions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('gift_card_id')->constrained()->cascadeOnDelete();
            $table->foreignId('order_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('credit_memo_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('admin_id')->nullable()->constrained()->nullOnDelete();
            $table->decimal('amount', 10, 2); // negative = spent
            $table->decimal('balance_after', 10, 2);
            $table->string('note', 500)->nullable();
            $table->timestamp('created_at')->nullable();
        });

        Schema::table('products', function (Blueprint $table) {
            $table->string('type', 20)->default('simple')->after('sku');
            $table->json('gift_card_amounts')->nullable()->after('weight');
            $table->decimal('gift_card_min_amount', 10, 2)->nullable()->after('gift_card_amounts');
            $table->decimal('gift_card_max_amount', 10, 2)->nullable()->after('gift_card_min_amount');
        });

        Schema::table('order_items', function (Blueprint $table) {
            $table->json('gift_card')->nullable(); // { amount, recipient_name, recipient_email, message }
        });

        Schema::table('orders', function (Blueprint $table) {
            $table->foreignId('gift_card_id')->nullable()->after('coupon_code')->constrained()->nullOnDelete();
            $table->decimal('gift_card_amount', 10, 2)->default(0)->after('gift_card_id');
        });

        Schema::table('credit_memos', function (Blueprint $table) {
            $table->decimal('gift_card_refund', 10, 2)->default(0)->after('total');
        });
    }

    public function down(): void
    {
        Schema::table('credit_memos', fn (Blueprint $table) => $table->dropColumn('gift_card_refund'));
        Schema::table('orders', function (Blueprint $table) {
            $table->dropConstrainedForeignId('gift_card_id');
            $table->dropColumn('gift_card_amount');
        });
        Schema::table('order_items', fn (Blueprint $table) => $table->dropColumn('gift_card'));
        Schema::table('products', fn (Blueprint $table) => $table->dropColumn(['type', 'gift_card_amounts', 'gift_card_min_amount', 'gift_card_max_amount']));
        Schema::dropIfExists('gift_card_transactions');
        Schema::dropIfExists('gift_cards');
    }
};

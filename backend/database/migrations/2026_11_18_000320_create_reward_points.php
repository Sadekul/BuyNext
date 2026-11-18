<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Phase 11: reward points. customers.reward_points is the balance; every
 * change is a reward_transactions row (App\Services\RewardPoints, with the
 * customer row locked). unique_key makes "once per order / account /
 * customer and product" hold even when two requests race.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('customers', function (Blueprint $table) {
            $table->integer('reward_points')->default(0);
        });

        Schema::create('reward_transactions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('customer_id')->constrained()->cascadeOnDelete();
            $table->integer('points'); // signed
            $table->integer('balance_after');
            $table->string('type', 20); // earn | spend | cancel_return | refund_return | refund_reverse | signup | review | adjust
            $table->foreignId('order_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('credit_memo_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('review_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('admin_id')->nullable()->constrained()->nullOnDelete();
            $table->string('note', 255)->nullable();
            $table->string('unique_key', 80)->nullable()->unique();
            $table->timestamp('created_at')->nullable();
            $table->index(['customer_id', 'id']);
            $table->index(['type', 'created_at']);
        });

        Schema::table('orders', function (Blueprint $table) {
            $table->unsignedInteger('reward_points_spent')->default(0)->after('gift_card_amount');
            $table->decimal('reward_points_amount', 10, 2)->default(0)->after('reward_points_spent');
            $table->unsignedInteger('reward_points_earned')->nullable()->after('reward_points_amount');
        });

        Schema::table('credit_memos', function (Blueprint $table) {
            $table->decimal('reward_points_refund', 10, 2)->default(0)->after('gift_card_refund');
            $table->unsignedInteger('reward_points_returned')->default(0)->after('reward_points_refund');
            $table->unsignedInteger('reward_points_reversed')->default(0)->after('reward_points_returned');
        });
    }

    public function down(): void
    {
        Schema::table('credit_memos', fn (Blueprint $table) => $table->dropColumn(['reward_points_refund', 'reward_points_returned', 'reward_points_reversed']));
        Schema::table('orders', fn (Blueprint $table) => $table->dropColumn(['reward_points_spent', 'reward_points_amount', 'reward_points_earned']));
        Schema::dropIfExists('reward_transactions');
        Schema::table('customers', fn (Blueprint $table) => $table->dropColumn('reward_points'));
    }
};

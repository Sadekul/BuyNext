<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Phase 10 (part B): webhook events of every payment provider, so a retried
 * event is handled once. Generalises phase 8's stripe_events: the key is
 * (provider, id), Stripe's rows move here with provider "stripe".
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payment_events', function (Blueprint $table) {
            $table->string('provider', 20);
            $table->string('id', 191); // the provider's event id (evt_..., WH-...)
            $table->string('type', 100);
            $table->timestamp('processed_at')->nullable();
            $table->timestamp('created_at')->nullable();
            $table->primary(['provider', 'id']);
        });

        if (Schema::hasTable('stripe_events')) {
            DB::table('stripe_events')->orderBy('id')->chunk(500, function ($rows) {
                DB::table('payment_events')->insertOrIgnore($rows->map(fn ($row) => [
                    'provider' => 'stripe',
                    'id' => mb_substr($row->id, 0, 191),
                    'type' => $row->type,
                    'processed_at' => $row->processed_at,
                    'created_at' => $row->created_at,
                ])->all());
            });
            Schema::drop('stripe_events');
        }
    }

    public function down(): void
    {
        Schema::create('stripe_events', function (Blueprint $table) {
            $table->string('id', 255)->primary();
            $table->string('type', 100);
            $table->timestamp('processed_at')->nullable();
            $table->timestamp('created_at')->nullable();
        });
        DB::table('payment_events')->where('provider', 'stripe')->orderBy('id')->chunk(500, function ($rows) {
            DB::table('stripe_events')->insertOrIgnore($rows->map(fn ($row) => [
                'id' => $row->id, 'type' => $row->type, 'processed_at' => $row->processed_at, 'created_at' => $row->created_at,
            ])->all());
        });
        Schema::dropIfExists('payment_events');
    }
};

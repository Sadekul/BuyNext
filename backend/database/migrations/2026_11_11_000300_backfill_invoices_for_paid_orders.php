<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/*
 * Orders marked paid before invoices existed (phase 2's "Mark as paid") have
 * no invoice, so phase 3 would see them as unpaid: "paid" totals of 0 and no
 * way to refund. Give each one the invoice it would have had.
 */
return new class extends Migration
{
    public function up(): void
    {
        $orders = DB::table('orders')
            ->whereIn('payment_status', ['paid', 'partially_refunded', 'refunded'])
            ->whereNotExists(fn ($query) => $query->from('invoices')->whereColumn('invoices.order_id', 'orders.id'))
            ->get(['id', 'grand_total', 'updated_at']);

        foreach ($orders as $order) {
            $id = DB::table('invoices')->insertGetId([
                'number' => null, // set from the id just below, like every invoice
                'order_id' => $order->id,
                'amount' => $order->grand_total,
                'admin_id' => null,
                'note' => 'Recorded automatically: this order was marked paid before invoices existed.',
                'customer_notified' => false,
                'created_at' => $order->updated_at,
            ]);
            DB::table('invoices')->where('id', $id)->update(['number' => 'INV-'.(100000 + $id)]);
        }
    }

    public function down(): void
    {
        DB::table('invoices')->where('note', 'like', 'Recorded automatically:%')->delete();
    }
};

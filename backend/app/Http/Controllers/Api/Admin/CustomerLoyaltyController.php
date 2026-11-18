<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Api\V1\RewardController;
use App\Http\Controllers\Controller;
use App\Models\Customer;
use App\Models\WishlistItem;
use App\Services\Pricing;
use App\Services\RewardPoints;
use App\Services\Wishlists;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Phase 11: the customer page's Wishlist and Reward points tabs. */
class CustomerLoyaltyController extends Controller
{
    /**
     * GET /api/admin/v1/customers/{id}/wishlist → { data: [{ id, product: { id, name, sku, thumbnail_url, status, deleted },
     * variant, note, added_at }], meta: { shared, shared_at } } (every row, hidden products included).
     */
    public function wishlist(int $id, Wishlists $wishlists): JsonResponse
    {
        $customer = Customer::find($id);
        if (! $customer) {
            return $this->notFound();
        }
        $items = $wishlists->items($customer, visibleOnly: false);

        return response()->json([
            'data' => $items->map(fn (WishlistItem $item) => [
                'id' => $item->id,
                'product' => $item->product ? [
                    'id' => $item->product->id,
                    'name' => $item->product->name,
                    'sku' => $item->product->sku,
                    'thumbnail_url' => $item->product->thumbnail_url,
                    'status' => $item->product->status,
                    'deleted' => $item->product->trashed(),
                ] : null,
                'variant' => Wishlists::variant($item),
                'note' => $item->note,
                'added_at' => $item->created_at?->toIso8601ZuluString(),
            ])->values(),
            'meta' => [
                'shared' => $customer->wishlist_share_hash !== null,
                'shared_at' => $customer->wishlist_shared_at?->toIso8601ZuluString(),
            ],
        ]);
    }

    /** GET /api/admin/v1/customers/{id}/rewards?page&per_page → the customer's answer, with admin_name and credit_memo_number. */
    public function rewards(Request $request, int $id, RewardPoints $rewards): JsonResponse
    {
        $customer = Customer::find($id);

        return $customer ? response()->json(RewardController::summary($request, $customer, $rewards, true)) : $this->notFound();
    }

    /** POST /api/admin/v1/customers/{id}/rewards/adjust { points (signed), note } → { data: { balance, value, transaction } } (audited). */
    public function adjust(Request $request, int $id, RewardPoints $rewards): JsonResponse
    {
        $customer = Customer::find($id);
        if (! $customer) {
            return $this->notFound();
        }
        $data = $request->validate([
            'points' => ['required', 'integer', 'not_in:0', 'min:-1000000', 'max:1000000'],
            'note' => ['required', 'string', 'min:2', 'max:255'],
        ], [
            'points.required' => 'Enter the points to add (or a negative number to remove).',
            'points.not_in' => 'Enter a number other than 0.',
            'note.required' => 'Say why the balance changes.',
        ]);
        $transaction = $rewards->adjust($customer, (int) $data['points'], trim($data['note']), $request->user());
        $transaction->load(['admin:id,name']);

        return response()->json(['data' => [
            'balance' => $transaction->balance_after,
            'value' => Pricing::format($rewards->valueCents($transaction->balance_after)),
            'transaction' => RewardPoints::api($transaction, true),
        ]]);
    }

    private function notFound(): JsonResponse
    {
        return response()->json(['message' => 'Customer not found.'], 404);
    }
}

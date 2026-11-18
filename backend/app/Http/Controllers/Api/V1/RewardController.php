<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Customer;
use App\Models\RewardTransaction;
use App\Services\Pricing;
use App\Services\RewardPoints;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Phase 11: the signed-in customer's reward points: balance, its value, and the history. */
class RewardController extends Controller
{
    /**
     * GET /api/v1/me/rewards?page&per_page → { data: { enabled, balance, value, point_value, transactions: [tx] }, links, meta }
     * (links and meta paginate the transactions, newest first).
     */
    public function show(Request $request, RewardPoints $rewards): JsonResponse
    {
        return response()->json(self::summary($request, $request->user(), $rewards, false));
    }

    /** The answer shared with the admin's customer page ($forStaff adds admin_name and credit_memo_number). */
    public static function summary(Request $request, Customer $customer, RewardPoints $rewards, bool $forStaff): array
    {
        $data = $request->validate(['per_page' => ['nullable', 'integer', 'min:1', 'max:100']]);
        $page = RewardTransaction::where('customer_id', $customer->id)->with(['order:id,number', 'creditMemo:id,number', 'admin:id,name'])
            ->orderByDesc('id')->paginate($data['per_page'] ?? 20)->withQueryString();
        $balance = (int) Customer::whereKey($customer->id)->value('reward_points');
        $paginated = $page->toArray();

        return [
            'data' => [
                'enabled' => $rewards->enabled(),
                'balance' => $balance,
                'value' => Pricing::format($rewards->valueCents($balance)),
                'point_value' => $rewards->pointValueString(),
                'transactions' => collect($page->items())->map(fn (RewardTransaction $tx) => RewardPoints::api($tx, $forStaff))->values()->all(),
            ],
            'links' => [
                'first' => $paginated['first_page_url'], 'last' => $paginated['last_page_url'],
                'prev' => $paginated['prev_page_url'], 'next' => $paginated['next_page_url'],
            ],
            'meta' => [
                'current_page' => $page->currentPage(), 'from' => $page->firstItem(), 'last_page' => $page->lastPage(),
                'per_page' => $page->perPage(), 'to' => $page->lastItem(), 'total' => $page->total(),
            ],
        ];
    }
}

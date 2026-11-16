<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Services\CustomerCarts;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Phase 7: the signed-in customer's saved cart, so it follows them to
 * another device. It is saved by POST /cart/validate (CartController).
 */
class CustomerCartController extends Controller
{
    public function __construct(private CustomerCarts $carts) {}

    /** GET /api/v1/me/cart → { items: [{ product_id, variant_id, quantity }], item_count, updated_at } */
    public function show(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->carts->restore($request->user())]);
    }

    /**
     * POST /api/v1/me/cart/merge { items } - adds the browser's cart to the
     * saved one (quantities added, capped by stock). Call once after sign-in.
     */
    public function merge(Request $request): JsonResponse
    {
        $data = $request->validate([
            'items' => ['present', 'array', 'max:50'],
            'items.*.product_id' => ['required', 'integer', 'min:1'],
            'items.*.variant_id' => ['nullable', 'integer', 'min:1'],
            'items.*.quantity' => ['required', 'integer', 'min:1', 'max:999'],
        ], CartController::messages());

        return response()->json(['data' => $this->carts->merge($request->user(), $data['items'])]);
    }
}

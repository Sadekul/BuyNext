<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Services\WelcomeCoupons;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Validation\Rule;

/**
 * Phase 19: Marketing → Welcome coupon. The settings (with a preview of the
 * offer, also while it is off), the numbers, and the codes issued so far.
 * Same permissions as Coupons (coupons.view to read, coupons.edit to change).
 */
class WelcomeCouponController extends Controller
{
    public function __construct(private WelcomeCoupons $welcome) {}

    /** GET /api/admin/v1/marketing/welcome-coupon → { data: { settings, offer, stats } } */
    public function show(): JsonResponse
    {
        return response()->json(['data' => $this->welcome->adminPayload()]);
    }

    /** PUT /api/admin/v1/marketing/welcome-coupon { welcome_coupon_*? } (partial) → { data: { settings, offer, stats } } */
    public function update(Request $request): JsonResponse
    {
        $this->welcome->update($this->welcome->validated($request->all()));

        return response()->json(['data' => $this->welcome->adminPayload()]);
    }

    /**
     * GET /api/admin/v1/marketing/welcome-coupon/codes?status=active|used|expired&search&page&per_page
     * → { data: [{ id, code, email, trigger, customer, issued_at, expires_at, status, used_on_order }], links, meta }, newest first.
     */
    public function codes(Request $request): AnonymousResourceCollection
    {
        $data = $request->validate([
            'status' => ['nullable', Rule::in(WelcomeCoupons::STATUSES)],
            'search' => ['nullable', 'string', 'max:100'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        return JsonResource::collection($this->welcome->codes($data['status'] ?? null, $data['search'] ?? null, (int) ($data['per_page'] ?? 20)));
    }
}

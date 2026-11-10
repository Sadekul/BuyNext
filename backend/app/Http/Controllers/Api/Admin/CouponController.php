<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Http\Resources\CouponResource;
use App\Models\Coupon;
use App\Services\Pricing;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Carbon;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/** Coupons (Marketing → Coupons): list, create, edit, disable/delete. */
class CouponController extends Controller
{
    private const MONEY = 'regex:/^\d{1,7}(\.\d{1,2})?$/';

    /** GET /api/admin/v1/coupons?search&status&page&per_page - newest first. */
    public function index(Request $request): AnonymousResourceCollection
    {
        $data = $request->validate([
            'search' => ['nullable', 'string', 'max:100'],
            'status' => ['nullable', Rule::in(Coupon::STATUSES)],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $coupons = Coupon::query()
            ->when($data['search'] ?? null, function ($query, $search) {
                $like = '%'.addcslashes($search, '%_\\').'%';
                $query->where(fn ($q) => $q->where('code', 'like', $like)->orWhere('description', 'like', $like));
            })
            ->when($data['status'] ?? null, fn ($query, $status) => $query->withStatus($status))
            ->latest('id')
            ->paginate($data['per_page'] ?? 20)
            ->withQueryString();

        return CouponResource::collection($coupons);
    }

    /** GET /api/admin/v1/coupons/{id} */
    public function show(int $id): CouponResource|JsonResponse
    {
        $coupon = Coupon::find($id);

        return $coupon ? new CouponResource($coupon) : $this->notFound();
    }

    /** POST /api/admin/v1/coupons → 201 */
    public function store(Request $request): JsonResponse
    {
        $coupon = new Coupon(['is_active' => true]);
        $this->save($coupon, $this->validated($request, null));

        return (new CouponResource($coupon->fresh()))->response()->setStatusCode(201);
    }

    /** PATCH /api/admin/v1/coupons/{id} - any of the create fields. */
    public function update(Request $request, int $id): CouponResource|JsonResponse
    {
        $coupon = Coupon::find($id);
        if (! $coupon) {
            return $this->notFound();
        }
        $this->save($coupon, $this->validated($request, $coupon));

        return new CouponResource($coupon->fresh());
    }

    /**
     * DELETE /api/admin/v1/coupons/{id}. A coupon that orders used is only
     * disabled (200 with the coupon), so those orders keep their history;
     * an unused one is deleted (204).
     */
    public function destroy(int $id): CouponResource|JsonResponse
    {
        $coupon = Coupon::find($id);
        if (! $coupon) {
            return $this->notFound();
        }
        if ($coupon->redemptions()->exists()) {
            $coupon->forceFill(['is_active' => false])->save();

            return new CouponResource($coupon->fresh());
        }
        $coupon->delete();

        return response()->json(null, 204);
    }

    /** Validates a create (all required fields) or a partial PATCH, checking the merged result. */
    private function validated(Request $request, ?Coupon $coupon): array
    {
        $creating = $coupon === null;
        $required = $creating ? 'required' : 'sometimes';
        if ($request->has('code')) {
            $request->merge(['code' => Coupon::normalize($request->input('code'))]);
        }

        $data = $request->validate([
            'code' => [$required, 'string', 'min:3', 'max:40', 'regex:/^[A-Z0-9_-]+$/', Rule::unique('coupons', 'code')->ignore($coupon?->id)],
            'description' => ['nullable', 'string', 'max:160'],
            'type' => [$required, Rule::in(Coupon::TYPES)],
            'value' => ['nullable', self::MONEY],
            'min_subtotal' => ['nullable', self::MONEY],
            'starts_at' => ['nullable', 'date'],
            'ends_at' => ['nullable', 'date'],
            'usage_limit' => ['nullable', 'integer', 'min:1', 'max:1000000'],
            'usage_limit_per_customer' => ['nullable', 'integer', 'min:1', 'max:1000'],
            'is_active' => ['nullable', 'boolean'],
        ], [
            'code.required' => 'Enter a code.',
            'code.regex' => 'A code has only letters, digits, dashes, and underscores.',
            'code.unique' => 'There is already a coupon with this code.',
            'type.in' => 'Choose a type: percent, fixed, or free shipping.',
            'value.regex' => 'Enter the value as a number with at most 2 decimals.',
            'min_subtotal.regex' => 'Enter the minimum as an amount, for example 50.00.',
        ]);

        // A date without a time: starts at the start of that day, ends at its end.
        foreach (['starts_at' => 'startOfDay', 'ends_at' => 'endOfDay'] as $field => $edge) {
            if (! empty($data[$field])) {
                $date = Carbon::parse($data[$field])->utc();
                $data[$field] = preg_match('/^\d{4}-\d{2}-\d{2}$/', $data[$field]) ? $date->$edge() : $date;
            }
        }

        // The value rules depend on the type, so check the coupon as it will be after this change.
        $type = $data['type'] ?? $coupon?->type;
        $valueGiven = array_key_exists('value', $data) || array_key_exists('type', $data);
        $value = array_key_exists('value', $data) ? (float) ($data['value'] ?? 0) : (float) ($coupon?->value ?? 0);
        $errors = [];
        if ($valueGiven && $type === 'percent' && ($value < 1 || $value > 100)) {
            $errors['value'] = 'A percent discount is between 1 and 100.';
        } elseif ($valueGiven && $type === 'fixed' && $value <= 0) {
            $errors['value'] = 'A fixed discount must be more than $0.00.';
        }
        if ($type === 'free_shipping') {
            $data['value'] = '0.00'; // free shipping has no merchandise discount
        }
        $startsAt = array_key_exists('starts_at', $data) ? $data['starts_at'] : $coupon?->starts_at;
        $endsAt = array_key_exists('ends_at', $data) ? $data['ends_at'] : $coupon?->ends_at;
        if ($startsAt && $endsAt && $endsAt <= $startsAt) {
            $errors['ends_at'] = 'The end date must be after the start date.';
        }
        if ($errors) {
            throw ValidationException::withMessages($errors);
        }

        return $data;
    }

    private function save(Coupon $coupon, array $data): void
    {
        $coupon->fill($data);
        // No description given: write one from the rule ("10% off your order").
        if (blank($coupon->description)) {
            $coupon->description = Coupon::describe(
                $coupon->type,
                Pricing::toCents($coupon->value ?? 0),
                $coupon->min_subtotal !== null ? Pricing::toCents($coupon->min_subtotal) : null,
            );
        }
        $coupon->save();
    }

    private function notFound(): JsonResponse
    {
        return response()->json(['message' => 'Coupon not found.'], 404);
    }
}

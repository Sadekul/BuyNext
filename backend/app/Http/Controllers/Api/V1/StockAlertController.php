<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Customer;
use App\Models\Product;
use App\Models\StockAlert;
use App\Services\StockAlerts;
use App\Support\CategoryTree;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Validation\ValidationException;

/**
 * Phase 9 (part B): "Email me when it's back in stock" (store side).
 * Asking always answers the same 202, so nobody can learn whether an email
 * address was already listed.
 */
class StockAlertController extends Controller
{
    public function __construct(private StockAlerts $alerts) {}

    /** POST /api/v1/products/{id}/stock-alerts { email?, variant_id? } → 202 */
    public function store(Request $request, int $id): JsonResponse
    {
        $tree = CategoryTree::load();
        $product = Product::forSale($tree)->with('variants')->find($id);
        if (! $product) {
            return response()->json(['message' => __('Product not found.')], 404);
        }
        $customer = $request->user() instanceof Customer ? $request->user() : null;

        $data = $request->validate([
            'email' => [$customer ? 'nullable' : 'required', 'string', 'email:rfc', 'max:190'],
            'variant_id' => ['nullable', 'integer'],
        ], [
            'email.required' => __('Enter your email address.'),
            'email.email' => __('Enter a valid email address.'),
            'variant_id.integer' => __('Choose one of this product\'s options.'),
        ]);

        $variant = null;
        if (isset($data['variant_id'])) {
            $variant = $product->has_variants ? $product->variants->firstWhere('id', (int) $data['variant_id']) : null;
            if (! $variant || ! $variant->is_active) {
                throw ValidationException::withMessages(['variant_id' => __('This option of the product isn\'t available.')]);
            }
        }
        if ($this->alerts->isAvailable($product, $variant, $tree)) {
            throw ValidationException::withMessages(['stock' => __('This item is in stock, so you can order it now.')]);
        }

        $this->alerts->subscribe($product, $variant, $customer ? $customer->email : $data['email'], $customer);

        return response()->json(['data' => ['message' => __(StockAlerts::MESSAGE)]], 202);
    }

    /** GET /api/v1/me/stock-alerts → the account's waiting alerts. */
    public function index(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->alerts->waitingFor($request->user())->map(fn (StockAlert $alert) => StockAlerts::item($alert))->values()]);
    }

    /** DELETE /api/v1/me/stock-alerts/{id} → 204 */
    public function destroy(Request $request, int $id): Response|JsonResponse
    {
        $alert = $this->alerts->waitingFor($request->user())->firstWhere('id', $id);
        if (! $alert) {
            return response()->json(['message' => __('Stock alert not found.')], 404);
        }
        $alert->delete();

        return response()->noContent();
    }

    /** POST /api/v1/stock-alerts/unsubscribe { token } → { data: { removed } } (the email's "stop these alerts" link). */
    public function unsubscribe(Request $request): JsonResponse
    {
        $data = $request->validate(['token' => ['required', 'string', 'max:100']]);
        $removed = $this->alerts->unsubscribe($data['token']);
        if ($removed === null) {
            throw ValidationException::withMessages(['token' => __('This link isn\'t valid. Copy the whole link from the email, or contact us.')]);
        }

        return response()->json(['data' => ['removed' => $removed]]);
    }
}

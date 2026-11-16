<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\Admin;
use App\Models\Category;
use App\Models\Product;
use App\Services\Audit;
use App\Services\Pricing;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Mass actions on the product grid (Magento's "Actions" dropdown):
 * POST /api/admin/v1/products/bulk { ids: [1..200], action, value? }
 *
 * The route needs products.edit; `delete` also needs products.delete.
 * All or nothing, in one transaction, with one audit entry per product.
 * Answer: { data: { updated, skipped: [{ id, reason }] } }.
 */
class ProductBulkController extends Controller
{
    public const ACTIONS = ['enable', 'disable', 'archive', 'delete', 'set_category', 'adjust_price', 'set_stock'];

    private const MAX_PRICE_CENTS = 100_000_000;

    public function __construct(private Audit $audit) {}

    public function __invoke(Request $request): JsonResponse
    {
        $data = $request->validate([
            'ids' => ['required', 'array', 'min:1', 'max:200'],
            'ids.*' => ['integer', 'min:1', 'distinct'],
            'action' => ['required', Rule::in(self::ACTIONS)],
            'value' => match ($request->input('action')) {
                'set_category' => ['required', 'integer', Rule::exists('categories', 'id')],
                'adjust_price' => ['required', 'array'],
                'set_stock' => ['required', 'integer', 'min:0', 'max:100000'],
                default => ['nullable'],
            },
            'value.mode' => $request->input('action') === 'adjust_price' ? ['required', 'in:percent,fixed'] : ['nullable'],
            'value.amount' => $request->input('action') === 'adjust_price'
                ? ['required', 'numeric', 'decimal:0,2', 'not_in:0', 'min:-1000000', 'max:1000000'] : ['nullable'],
        ], [
            'ids.required' => 'Select at least one product.',
            'ids.max' => 'Select at most 200 products at a time.',
            'action.in' => 'Choose an action.',
            'value.required' => 'This action needs a value.',
            'value.exists' => 'Choose a category from the list.',
            'value.min' => 'The stock can\'t be negative.',
            'value.amount.not_in' => 'Enter an amount other than 0.',
        ]);

        $admin = $request->user();
        if ($data['action'] === 'delete' && (! $admin instanceof Admin || ! $admin->hasPermission('products.delete'))) {
            return response()->json(['message' => 'Your role doesn\'t allow this.', 'code' => 'permission_denied', 'permission' => 'products.delete'], 403);
        }

        $ids = array_map('intval', $data['ids']);
        $result = DB::transaction(function () use ($ids, $data) {
            sort($ids);
            $products = Product::whereIn('id', $ids)->orderBy('id')->lockForUpdate()->with('variants')->get()->keyBy('id');
            $missing = array_values(array_diff($ids, $products->keys()->all()));
            if ($missing) {
                throw ValidationException::withMessages(['ids' => 'These products no longer exist: '.implode(', ', $missing).'.']);
            }

            return match ($data['action']) {
                'enable' => $this->setStatus($products, 'active'),
                'disable' => $this->setStatus($products, 'draft'),
                'archive' => $this->setStatus($products, 'archived'),
                'delete' => $this->delete($products),
                'set_category' => $this->setCategory($products, (int) $data['value']),
                'adjust_price' => $this->adjustPrice($products, $data['value']['mode'], (string) $data['value']['amount']),
                'set_stock' => $this->setStock($products, (int) $data['value']),
            };
        });

        return response()->json(['data' => $result]);
    }

    private function setStatus($products, string $status): array
    {
        foreach ($products as $product) {
            $this->change($product, ['status' => $status]);
        }

        return ['updated' => $products->count(), 'skipped' => []];
    }

    private function delete($products): array
    {
        foreach ($products as $product) {
            $product->delete();
            $this->audit->record('product.deleted', "Product {$product->sku} \"{$product->name}\" deleted (bulk action).", 'product', $product->id,
                Audit::deleted(Audit::fieldsOf($product, ['name', 'sku', 'status', 'price', 'stock_quantity'])));
        }

        return ['updated' => $products->count(), 'skipped' => []];
    }

    private function setCategory($products, int $categoryId): array
    {
        foreach ($products as $product) {
            $this->change($product, ['category_id' => $categoryId]);
        }

        return ['updated' => $products->count(), 'skipped' => []];
    }

    /**
     * percent: price × (1 + amount / 100), rounded to the cent (halves up);
     * fixed: price + amount. Variants with their own price change the same way.
     * Any result under 0.01 (or over 1,000,000) → 422 naming the products.
     */
    private function adjustPrice($products, string $mode, string $amount): array
    {
        $adjust = fn (string $price) => $mode === 'percent'
            ? Pricing::jsRound(Pricing::toCents($price) * (100 + (float) $amount) / 100)
            : Pricing::toCents($price) + Pricing::toCents($amount);

        $bad = [];
        foreach ($products as $product) {
            $prices = [$adjust($product->price), ...$product->variants->whereNotNull('price')->map(fn ($v) => $adjust($v->price))->all()];
            if (min($prices) < 1 || max($prices) > self::MAX_PRICE_CENTS) {
                $bad[] = "{$product->name} ({$product->sku})";
            }
        }
        if ($bad) {
            throw ValidationException::withMessages(['value.amount' => 'This would make the price less than 0.01 (or more than 1,000,000) for: '.implode(', ', $bad).'.']);
        }

        foreach ($products as $product) {
            $variantPrices = [];
            foreach ($product->variants->whereNotNull('price') as $variant) {
                $before = $variant->price;
                $variant->update(['price' => Pricing::format($adjust($variant->price))]);
                $variantPrices[$variant->sku] = [$before, $variant->price];
            }
            $this->change($product, ['price' => Pricing::format($adjust($product->price))], $variantPrices);
        }

        return ['updated' => $products->count(), 'skipped' => []];
    }

    /** Products with variants keep their per-variant stock: they are skipped. */
    private function setStock($products, int $stock): array
    {
        $skipped = [];
        $updated = 0;
        foreach ($products as $product) {
            if ($product->has_variants) {
                $skipped[] = ['id' => $product->id, 'reason' => 'This product has variants: set the stock of each variant instead.'];

                continue;
            }
            $this->change($product, ['stock_quantity' => $stock]);
            $updated++;
        }

        return ['updated' => $updated, 'skipped' => $skipped];
    }

    /** Saves $fields and writes the product's audit entry (only when something changed). */
    private function change(Product $product, array $fields, array $variantPrices = []): void
    {
        $before = Audit::fieldsOf($product, array_keys($fields));
        $product->forceFill($fields)->save();
        $changes = Audit::diff($before, Audit::fieldsOf($product, array_keys($fields)));
        if ($changes && $variantPrices) {
            $changes['before']['variant_prices'] = array_map(fn ($pair) => $pair[0], $variantPrices);
            $changes['after']['variant_prices'] = array_map(fn ($pair) => $pair[1], $variantPrices);
        }
        if ($changes) {
            if (isset($fields['category_id'])) {
                $changes['before']['category'] = Category::find($changes['before']['category_id'])?->slug;
                $changes['after']['category'] = Category::find($changes['after']['category_id'])?->slug;
            }
            $this->audit->record('product.updated', "Product {$product->sku} \"{$product->name}\" updated (bulk action).", 'product', $product->id, $changes);
        }
    }
}

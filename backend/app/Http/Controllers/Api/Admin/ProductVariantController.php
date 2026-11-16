<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Http\Resources\AdminProductResource;
use App\Models\Product;
use App\Models\ProductOption;
use App\Models\ProductVariant;
use App\Services\Audit;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Configurable products (Magento): options ("Size": S, M, L), and variants,
 * one per combination of values, each with its own SKU, stock, and optional
 * price. A product with options sells only through its active variants.
 * Every answer is the admin product detail (AdminProductResource).
 */
class ProductVariantController extends Controller
{
    public function __construct(private Audit $audit) {}

    /**
     * PUT /api/admin/v1/products/{id}/options { options: [{ name, values: [..] }] }
     * Replaces the options. Options and values are matched by name (ignoring
     * case), so the ones kept keep their ids and their variants stay valid.
     * Variants that used a removed value are deactivated (never deleted).
     * [] makes the product a simple product again.
     */
    public function options(Request $request, int $id): JsonResponse
    {
        $product = Product::find($id);
        if (! $product) {
            return $this->notFound();
        }
        $data = $request->validate([
            'options' => ['present', 'array', 'max:'.ProductOption::MAX_PER_PRODUCT],
            'options.*.name' => ['required', 'string', 'min:1', 'max:40', 'distinct:ignore_case'],
            'options.*.values' => ['required', 'array', 'min:1', 'max:'.ProductOption::MAX_VALUES],
            'options.*.values.*' => ['required', 'string', 'min:1', 'max:40', 'distinct:ignore_case'],
        ], [
            'options.max' => 'A product can have at most '.ProductOption::MAX_PER_PRODUCT.' options.',
            'options.*.name.required' => 'Enter the option name (for example "Size").',
            'options.*.name.distinct' => 'Each option name can be used once.',
            'options.*.values.required' => 'Add at least one value.',
            'options.*.values.min' => 'Add at least one value.',
            'options.*.values.max' => 'An option can have at most '.ProductOption::MAX_VALUES.' values.',
            'options.*.values.*.distinct' => 'Each value can be listed once.',
        ]);

        DB::transaction(function () use ($product, $data) {
            Product::whereKey($product->id)->lockForUpdate()->first();
            $product->load('options.values');
            $before = $this->describe($product);

            $existing = $product->options->keyBy(fn ($option) => mb_strtolower($option->name));
            $keptOptions = [];
            foreach (array_values($data['options']) as $position => $input) {
                $name = trim($input['name']);
                $option = $existing->get(mb_strtolower($name));
                if ($option) {
                    $option->update(['name' => $name, 'position' => $position]);
                } else {
                    $option = $product->options()->create(['name' => $name, 'position' => $position]);
                }
                $keptOptions[] = $option->id;

                $values = $option->values()->get()->keyBy(fn ($value) => mb_strtolower($value->value));
                $keptValues = [];
                foreach (array_values($input['values']) as $valuePosition => $text) {
                    $text = trim($text);
                    $value = $values->get(mb_strtolower($text));
                    if ($value) {
                        $value->update(['value' => $text, 'position' => $valuePosition]);
                    } else {
                        $value = $option->values()->create(['value' => $text, 'position' => $valuePosition]);
                    }
                    $keptValues[] = $value->id;
                }
                $option->values()->whereNotIn('id', $keptValues)->delete();
            }
            $product->options()->whereNotIn('id', $keptOptions)->delete();

            $product->forceFill(['has_variants' => $keptOptions !== []])->save();
            $product->unsetRelation('options');
            $this->deactivateStale($product);
            $product->syncVariantStock();

            $after = $this->describe($product);
            if ($before !== $after) {
                $this->audit->record('product.options_updated', "Options of product {$product->sku} changed.", 'product', $product->id,
                    ['before' => ['options' => $before], 'after' => ['options' => $after]]);
            }
        });

        return $this->answer($product);
    }

    /**
     * POST /api/admin/v1/products/{id}/variants/generate - creates every
     * missing combination: SKU {product sku}-{value}-{value} (upper-case, only
     * letters, digits, dashes), stock 0, inactive. Existing ones are left alone.
     * Answer: the product, with meta.created (how many were added).
     */
    public function generate(int $id): JsonResponse
    {
        $product = Product::find($id);
        if (! $product) {
            return $this->notFound();
        }

        $created = DB::transaction(function () use ($product) {
            Product::whereKey($product->id)->lockForUpdate()->first();
            $product->load('options.values');
            if ($product->options->isEmpty()) {
                throw ValidationException::withMessages(['options' => 'Add options (for example Size and Color) before generating variants.']);
            }

            $combinations = [[]];
            foreach ($product->options as $option) {
                $next = [];
                foreach ($combinations as $combination) {
                    foreach ($option->values as $value) {
                        $next[] = [...$combination, $value];
                    }
                }
                $combinations = $next;
            }

            $existing = $product->variants()->pluck('option_key')->all();
            $missing = array_values(array_filter($combinations,
                fn ($values) => ! in_array(ProductVariant::keyFor(array_map(fn ($v) => $v->id, $values)), $existing, true)));
            if (count($existing) + count($missing) > ProductVariant::MAX_PER_PRODUCT) {
                throw ValidationException::withMessages(['options' => 'That would make '.(count($existing) + count($missing))
                    .' variants; a product can have at most '.ProductVariant::MAX_PER_PRODUCT.'. Use fewer values.']);
            }

            $skus = [];
            foreach ($missing as $values) {
                $ids = array_map(fn ($v) => $v->id, $values);
                sort($ids);
                $sku = $this->uniqueSku(strtoupper(Str::slug(implode('-', [$product->sku, ...array_map(fn ($v) => $v->value, $values)]))), $skus);
                $skus[] = $sku;
                $product->variants()->create([
                    'sku' => $sku,
                    'option_value_ids' => $ids,
                    'option_key' => ProductVariant::keyFor($ids),
                    'price' => null,
                    'stock_quantity' => 0,
                    'is_active' => false,
                ]);
            }
            if ($skus) {
                $this->audit->record('product.variants_generated', count($skus).' '.Str::plural('variant', count($skus))." generated for product {$product->sku}.",
                    'product', $product->id, ['before' => [], 'after' => ['variants' => $skus]]);
            }

            return count($skus);
        });

        return $this->answer($product, ['created' => $created]);
    }

    /** PATCH /api/admin/v1/products/{id}/variants/{variant} { sku, price (null = the product's), stock_quantity, is_active } */
    public function update(Request $request, int $id, int $variant): JsonResponse
    {
        $found = ProductVariant::where('product_id', $id)->whereKey($variant)->first();
        $product = $found ? Product::find($id) : null;
        if (! $product) {
            return $this->notFound();
        }
        $data = $request->validate([
            'sku' => ['sometimes', 'string', 'max:64', 'regex:/^[A-Za-z0-9-]+$/', Rule::unique('product_variants', 'sku')->ignore($found->id),
                Rule::unique('products', 'sku')],
            'price' => ['sometimes', 'nullable', 'numeric', 'decimal:0,2', 'min:0.01', 'max:1000000'],
            'stock_quantity' => ['sometimes', 'integer', 'min:0', 'max:100000'],
            'is_active' => ['sometimes', 'boolean'],
        ], [
            'sku.unique' => 'Another product or variant already has this SKU.',
            'sku.regex' => 'The SKU can only contain letters, numbers, and dashes.',
            'price.decimal' => 'The price can have at most 2 decimal places.',
            'price.min' => 'The price must be at least 0.01 (leave it empty to use the product\'s price).',
        ]);

        DB::transaction(function () use ($product, $found, $data) {
            Product::whereKey($product->id)->lockForUpdate()->first();
            $variant = ProductVariant::whereKey($found->id)->lockForUpdate()->first();
            $fields = ['sku', 'price', 'stock_quantity', 'is_active'];
            $before = Audit::fieldsOf($variant, $fields);

            if (($data['is_active'] ?? false) && ! $this->isCurrent($product, $variant)) {
                throw ValidationException::withMessages(['is_active' => 'This variant uses an option value that was removed, so it can\'t be switched on.']);
            }
            if (array_key_exists('price', $data) && $data['price'] !== null) {
                $data['price'] = number_format((float) $data['price'], 2, '.', '');
            }
            $variant->fill($data)->save();
            $product->syncVariantStock();

            if ($changes = Audit::diff($before, Audit::fieldsOf($variant, $fields))) {
                $this->audit->record('product.variant_updated', "Variant {$variant->sku} of product {$product->sku} updated.", 'product', $product->id, $changes);
            }
        });

        return $this->answer($product);
    }

    /** Variants whose values are no longer all current are switched off. */
    private function deactivateStale(Product $product): void
    {
        foreach ($product->variants()->where('is_active', true)->get() as $variant) {
            if (! $this->isCurrent($product, $variant)) {
                $variant->update(['is_active' => false]);
            }
        }
    }

    private function isCurrent(Product $product, ProductVariant $variant): bool
    {
        $map = $product->optionValueMap();
        $ids = $variant->option_value_ids ?? [];

        return $product->has_variants && count($ids) === $product->options->count() && array_diff($ids, array_keys($map)) === [];
    }

    /** "Size: S, M / Color: Red" for the audit log. */
    private function describe(Product $product): array
    {
        return $product->options->map(fn ($option) => $option->name.': '.$option->values->pluck('value')->implode(', '))->all();
    }

    private function uniqueSku(string $base, array $taken): string
    {
        $base = substr($base, 0, 60);
        $sku = $base;
        for ($n = 2; in_array($sku, $taken, true) || Product::skuTaken($sku); $n++) {
            $sku = "{$base}-{$n}";
        }

        return $sku;
    }

    private function answer(Product $product, ?array $meta = null): JsonResponse
    {
        $resource = (new AdminProductResource($product->fresh(ProductController::DETAIL)))->withDetail();
        if ($meta !== null) {
            $resource->additional(['meta' => $meta]);
        }

        return $resource->response();
    }

    private function notFound(): JsonResponse
    {
        return response()->json(['message' => 'Not found.'], 404);
    }
}

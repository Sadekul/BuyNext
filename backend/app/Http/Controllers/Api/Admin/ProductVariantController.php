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
use Illuminate\Support\Facades\Validator;
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
     * PUT /api/admin/v1/products/{id}/options
     * { options: [{ name, type?, values: [{ value, swatch?, value_bn? } | "value"], name_bn?, values_bn? }] }
     * Replaces the options. Options and values are matched by name (ignoring
     * case), so the ones kept keep their ids and their variants stay valid.
     * Variants that used a removed value are deactivated (never deleted).
     * [] makes the product a simple product again.
     *
     * Phase 16: `type` "text" (default for new options; left out = a kept option keeps its type) or
     * "color" (at most one per product). Values of a color option need a swatch "#RRGGBB" (stored
     * upper-case): given, or (plain string / no `swatch` key) the one the kept value already has.
     * Text options store no swatch (any sent is ignored).
     */
    public function options(Request $request, int $id): JsonResponse
    {
        $product = Product::find($id);
        if (! $product) {
            return $this->notFound();
        }
        $product->load('options.values');
        $data = $this->validatedOptions($request, $product);

        DB::transaction(function () use ($product, $data) {
            Product::whereKey($product->id)->lockForUpdate()->first();
            $product->load('options.values');
            $before = $this->describe($product);

            $existing = $product->options->keyBy(fn ($option) => mb_strtolower($option->name));
            $keptOptions = [];
            foreach ($data as $position => $input) {
                $name = $input['name'];
                $option = $existing->get(mb_strtolower($name));
                $translations = $input['name_bn_given']
                    ? self::withBangla($option?->translations, 'name', $input['name_bn'])
                    : $option?->translations;
                $fields = ['name' => $name, 'type' => $input['type'], 'position' => $position, 'translations' => $translations];
                if ($option) {
                    $option->update($fields);
                } else {
                    $option = $product->options()->create($fields);
                }
                $keptOptions[] = $option->id;

                $values = $option->values()->get()->keyBy(fn ($value) => mb_strtolower($value->value));
                $keptValues = [];
                foreach ($input['values'] as $valuePosition => $valueInput) {
                    $text = $valueInput['value'];
                    $value = $values->get(mb_strtolower($text));
                    $valueTranslations = $valueInput['value_bn_given']
                        ? self::withBangla($value?->translations, 'value', $valueInput['value_bn'])
                        : $value?->translations;
                    $valueFields = ['value' => $text, 'swatch' => $valueInput['swatch'], 'position' => $valuePosition, 'translations' => $valueTranslations];
                    if ($value) {
                        $value->update($valueFields);
                    } else {
                        $value = $option->values()->create($valueFields);
                    }
                    $keptValues[] = $value->id;
                }
                // Images of removed values go back to "shown for every choice" (FK: null on delete).
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
     * Phase 16: validates the PUT /options body (values may be strings or { value, swatch, value_bn })
     * and answers the options ready to save:
     * [{ name, type, name_bn_given, name_bn, values: [{ value, swatch, value_bn_given, value_bn }] }].
     * Error paths stay as before (options.N.values.M for the value text) plus options.N.type and
     * options.N.values.M.swatch.
     */
    private function validatedOptions(Request $request, Product $product): array
    {
        $raw = $request->input('options');
        // Value objects become their text, so the phase 5 rules (and error paths) apply unchanged.
        $flat = $raw;
        if (is_array($raw)) {
            foreach ($raw as $n => $option) {
                if (is_array($option) && is_array($option['values'] ?? null)) {
                    foreach ($option['values'] as $m => $value) {
                        if (is_array($value)) {
                            $flat[$n]['values'][$m] = $value['value'] ?? null;
                        }
                    }
                }
            }
        }

        $existing = $product->options->keyBy(fn ($option) => mb_strtolower($option->name));
        $validator = Validator::make($request->has('options') ? ['options' => $flat] : [], [
            'options' => ['present', 'array', 'max:'.ProductOption::MAX_PER_PRODUCT],
            'options.*.name' => ['required', 'string', 'min:1', 'max:40', 'distinct:ignore_case'],
            'options.*.type' => ['sometimes', 'string', Rule::in(ProductOption::TYPES)],
            'options.*.values' => ['required', 'array', 'min:1', 'max:'.ProductOption::MAX_VALUES],
            'options.*.values.*' => ['required', 'string', 'min:1', 'max:40', 'distinct:ignore_case'],
            // Phase 13: Bangla names. name_bn: the option's; values_bn: one per value, same order (null/"" = English is shown).
            // Left out: the saved Bangla text of options/values that keep their name stays.
            'options.*.name_bn' => ['sometimes', 'nullable', 'string', 'max:40'],
            'options.*.values_bn' => ['sometimes', 'nullable', 'array'],
            'options.*.values_bn.*' => ['nullable', 'string', 'max:40'],
        ], [
            'options.max' => 'A product can have at most '.ProductOption::MAX_PER_PRODUCT.' options.',
            'options.*.name.required' => 'Enter the option name (for example "Size").',
            'options.*.name.distinct' => 'Each option name can be used once.',
            'options.*.type.in' => 'Choose "text" (buttons) or "color" (colour swatches).',
            'options.*.values.required' => 'Add at least one value.',
            'options.*.values.min' => 'Add at least one value.',
            'options.*.values.max' => 'An option can have at most '.ProductOption::MAX_VALUES.' values.',
            'options.*.values.*.distinct' => 'Each value can be listed once.',
        ]);

        // Swatches, value_bn in value objects, and one color option per product.
        $validator->after(function ($validator) use ($raw, $existing) {
            if (! is_array($raw)) {
                return;
            }
            $colorSeen = false;
            foreach (array_values($raw) as $n => $option) {
                if (! is_array($option)) {
                    continue;
                }
                $saved = is_string($option['name'] ?? null) ? $existing->get(mb_strtolower(trim($option['name']))) : null;
                $type = in_array($option['type'] ?? null, ProductOption::TYPES, true) ? $option['type'] : ($saved?->typeName() ?? 'text');
                if ($type === 'color') {
                    if ($colorSeen) {
                        $validator->errors()->add("options.{$n}.type", 'Only one option can use colour swatches.');
                    }
                    $colorSeen = true;
                }
                $savedValues = $saved ? $saved->values->keyBy(fn ($value) => mb_strtolower($value->value)) : collect();
                foreach (is_array($option['values'] ?? null) ? array_values($option['values']) : [] as $m => $value) {
                    $text = is_array($value) ? ($value['value'] ?? null) : $value;
                    if (is_array($value) && array_key_exists('value_bn', $value) && $value['value_bn'] !== null
                        && (! is_string($value['value_bn']) || mb_strlen($value['value_bn']) > 40)) {
                        $validator->errors()->add("options.{$n}.values.{$m}.value_bn", 'The Bangla value can be at most 40 characters.');
                    }
                    if ($type !== 'color' || ! is_string($text)) {
                        continue;
                    }
                    $given = is_array($value) && array_key_exists('swatch', $value);
                    $swatch = $given ? $value['swatch'] : $savedValues->get(mb_strtolower(trim($text)))?->swatch;
                    if ($swatch === null || $swatch === '') {
                        $validator->errors()->add("options.{$n}.values.{$m}.swatch", 'Choose a colour for '.trim($text).'.');
                    } elseif (! is_string($swatch) || ! preg_match(ProductOption::SWATCH_PATTERN, $swatch)) {
                        $validator->errors()->add("options.{$n}.values.{$m}.swatch", 'Enter the colour as #RRGGBB (for example #1E40AF).');
                    }
                }
            }
        });
        $validator->validate();

        $result = [];
        foreach (array_values($raw) as $option) {
            $name = trim($option['name']);
            $saved = $existing->get(mb_strtolower($name));
            $type = $option['type'] ?? ($saved?->typeName() ?? 'text');
            $savedValues = $saved ? $saved->values->keyBy(fn ($value) => mb_strtolower($value->value)) : collect();
            $valuesBn = is_array($option['values_bn'] ?? null) ? array_values($option['values_bn']) : null;
            $values = [];
            foreach (array_values($option['values']) as $m => $value) {
                $text = trim(is_array($value) ? $value['value'] : $value);
                $swatch = null;
                if ($type === 'color') {
                    $swatch = strtoupper(is_array($value) && array_key_exists('swatch', $value)
                        ? $value['swatch'] : $savedValues->get(mb_strtolower($text))->swatch);
                }
                $bnInObject = is_array($value) && array_key_exists('value_bn', $value);
                $values[] = [
                    'value' => $text,
                    'swatch' => $swatch,
                    'value_bn_given' => $bnInObject || $valuesBn !== null,
                    'value_bn' => $bnInObject ? $value['value_bn'] : ($valuesBn[$m] ?? null),
                ];
            }
            $result[] = [
                'name' => $name,
                'type' => $type,
                'name_bn_given' => array_key_exists('name_bn', $option),
                'name_bn' => $option['name_bn'] ?? null,
                'values' => $values,
            ];
        }

        return $result;
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
            'weight' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:1000000'], // phase 10 (part B): grams, null = the product's
        ], [
            'sku.unique' => 'Another product or variant already has this SKU.',
            'sku.regex' => 'The SKU can only contain letters, numbers, and dashes.',
            'price.decimal' => 'The price can have at most 2 decimal places.',
            'price.min' => 'The price must be at least 0.01 (leave it empty to use the product\'s price).',
        ]);

        DB::transaction(function () use ($product, $found, $data) {
            Product::whereKey($product->id)->lockForUpdate()->first();
            $variant = ProductVariant::whereKey($found->id)->lockForUpdate()->first();
            $fields = ['sku', 'price', 'stock_quantity', 'is_active', 'weight'];
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

    /** Phase 13: $translations with bn.$field set to $text (empty → removed; null when nothing is left). */
    private static function withBangla(?array $translations, string $field, mixed $text): ?array
    {
        $translations ??= [];
        $text = is_string($text) ? trim($text) : '';
        if ($text === '') {
            unset($translations['bn'][$field]);
            if (empty($translations['bn'])) {
                unset($translations['bn']);
            }
        } else {
            $translations['bn'][$field] = $text;
        }

        return $translations === [] ? null : $translations;
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

    /** "Size: S, M" / "Color (color): Red #FF0000, Blue #0000FF" for the audit log. */
    private function describe(Product $product): array
    {
        return $product->options->map(fn ($option) => $option->name.($option->typeName() === 'color' ? ' (color)' : '').': '
            .$option->values->map(fn ($value) => trim($value->value.' '.($value->swatch ?? '')))->implode(', '))->all();
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

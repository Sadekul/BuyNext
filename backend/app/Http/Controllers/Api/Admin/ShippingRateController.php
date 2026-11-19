<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\ShippingRate;
use App\Services\Audit;
use App\Services\Pricing;
use App\Services\Settings;
use App\Services\ShippingRates;
use App\Support\Csv;
use App\Support\Currency;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\Response;

/**
 * Phase 10 (part B): Settings → Shipping → Table rates (Magento's table
 * rates). Rows per method; the first matching row prices the method (see
 * App\Services\ShippingRates). Reading needs settings.view, changing settings.edit.
 */
class ShippingRateController extends Controller
{
    private const CSV_COLUMNS = ['method', 'country', 'min_weight_grams', 'max_weight_grams', 'min_subtotal', 'max_subtotal', 'price', 'position'];

    private const MAX_ROWS = 2000;

    public function __construct(private Audit $audit, private Settings $settings, private ShippingRates $rates) {}

    /** GET /api/admin/v1/shipping-rates?method= → { data: [Row], meta: { default_weight_grams, methods } } */
    public function index(Request $request): JsonResponse
    {
        $data = $request->validate(['method' => ['nullable', Rule::in($this->methodIds())]]);
        $rows = ShippingRate::when($data['method'] ?? null, fn ($q, $method) => $q->where('method', $method))
            ->orderBy('method')->orderBy('position')->orderBy('id')->get();

        return response()->json([
            'data' => $rows->map(fn (ShippingRate $rate) => $rate->toApi())->values(),
            'meta' => [
                'default_weight_grams' => (int) $this->settings->get('default_weight_grams'),
                'methods' => collect(config('buynest.store.shipping_methods'))->map(fn ($method, $id) => [
                    'id' => $id,
                    'label' => $method['label'],
                    'flat_price' => Pricing::format($this->settings->cents($method['price_setting'])),
                    'rows' => ShippingRate::where('method', $id)->count(),
                ])->values(),
            ],
        ]);
    }

    /** POST /api/admin/v1/shipping-rates → 201 { data: Row } */
    public function store(Request $request): JsonResponse
    {
        $data = $this->validRow($request->all(), creating: true);
        $rate = DB::transaction(function () use ($data) {
            $data['position'] ??= (int) ShippingRate::where('method', $data['method'])->max('position') + 1;
            $rate = ShippingRate::create($data);
            $this->audit->record('shipping_rate.created', "Shipping rate added for {$rate->method} ({$rate->country}): ".Currency::format($rate->price).'.',
                'shipping_rate', $rate->id, Audit::created($rate->toApi()));

            return $rate;
        });

        return response()->json(['data' => $rate->fresh()->toApi()], 201);
    }

    /** PATCH /api/admin/v1/shipping-rates/{id} → { data: Row } (only the fields sent change) */
    public function update(Request $request, int $id): JsonResponse
    {
        $rate = ShippingRate::find($id);
        if (! $rate) {
            return $this->notFound();
        }
        $data = $this->validRow([...$rate->only(['method', 'country', 'min_weight_grams', 'max_weight_grams', 'min_subtotal', 'max_subtotal', 'price']),
            ...$request->all()], creating: false);
        DB::transaction(function () use ($rate, $data) {
            $before = $rate->toApi();
            $rate->fill($data)->save();
            if ($changes = Audit::diff($before, $rate->fresh()->toApi())) {
                $this->audit->record('shipping_rate.updated', "Shipping rate #{$rate->id} ({$rate->method}) updated.", 'shipping_rate', $rate->id, $changes);
            }
        });

        return response()->json(['data' => $rate->fresh()->toApi()]);
    }

    /** DELETE /api/admin/v1/shipping-rates/{id} → 204 */
    public function destroy(int $id): JsonResponse
    {
        $rate = ShippingRate::find($id);
        if (! $rate) {
            return $this->notFound();
        }
        DB::transaction(function () use ($rate) {
            $rate->delete();
            $this->audit->record('shipping_rate.deleted', "Shipping rate #{$rate->id} ({$rate->method}, {$rate->country}) deleted.",
                'shipping_rate', $rate->id, Audit::deleted($rate->toApi()));
        });

        return response()->json(null, 204);
    }

    /** POST /api/admin/v1/shipping-rates/reorder { method, ids } → { data: [Row] } (every row of the method, in the new order) */
    public function reorder(Request $request): JsonResponse
    {
        $data = $request->validate([
            'method' => ['required', Rule::in($this->methodIds())],
            'ids' => ['required', 'array', 'max:'.self::MAX_ROWS],
            'ids.*' => ['integer', 'distinct'],
        ]);
        $current = ShippingRate::where('method', $data['method'])->pluck('id')->sort()->values()->all();
        $sent = collect($data['ids'])->map(fn ($id) => (int) $id)->sort()->values()->all();
        if ($current !== $sent) {
            throw ValidationException::withMessages(['ids' => 'Send every rate of this method exactly once.']);
        }
        DB::transaction(function () use ($data) {
            foreach (array_values($data['ids']) as $position => $id) {
                ShippingRate::whereKey($id)->update(['position' => $position]);
            }
            $this->audit->record('shipping_rate.reordered', "Shipping rates of {$data['method']} reordered.", 'shipping_rate', null,
                ['before' => [], 'after' => ['method' => $data['method'], 'ids' => array_map('intval', $data['ids'])]]);
        });

        return response()->json(['data' => ShippingRate::where('method', $data['method'])->orderBy('position')->orderBy('id')->get()
            ->map(fn (ShippingRate $rate) => $rate->toApi())->values()]);
    }

    /** GET /api/admin/v1/shipping-rates/export.csv */
    public function export(): Response
    {
        $rows = ShippingRate::orderBy('method')->orderBy('position')->orderBy('id')->get()->map(fn (ShippingRate $rate) => [
            $rate->method, $rate->country, $rate->min_weight_grams, $rate->max_weight_grams, $rate->min_subtotal, $rate->max_subtotal,
            $rate->price, $rate->position,
        ]);

        return Csv::download('shipping-rates-'.now()->toDateString().'.csv', self::CSV_COLUMNS, $rows);
    }

    /**
     * POST /api/admin/v1/shipping-rates/import (multipart: file, mode = replace | append)
     * → { data: { imported, replaced } }. "replace" (default) replaces the rows of the
     * methods in the file. All or nothing: any bad row → 422 { errors: { "rows.{line}.{field}": [...] } }.
     */
    public function import(Request $request): JsonResponse
    {
        $request->validate([
            'file' => ['required', 'file', 'max:2048'],
            'mode' => ['nullable', 'in:replace,append'],
        ], ['file.required' => 'Choose a CSV file.', 'file.max' => 'The file can be at most 2 MB.']);
        $content = preg_replace('/^\xEF\xBB\xBF/', '', (string) file_get_contents($request->file('file')->getRealPath()));
        if (! mb_check_encoding($content, 'UTF-8')) {
            throw ValidationException::withMessages(['file' => 'Save the file as CSV UTF-8 and try again.']);
        }

        $stream = fopen('php://temp', 'r+');
        fwrite($stream, $content);
        rewind($stream);
        $header = array_map(fn ($cell) => mb_strtolower(trim((string) $cell)), fgetcsv($stream, escape: '') ?: []);
        if (! in_array('method', $header, true) || ! in_array('price', $header, true)) {
            throw ValidationException::withMessages(['file' => 'The first row must name the columns: '.implode(', ', self::CSV_COLUMNS).' (method and price are required).']);
        }
        $rows = [];
        $errors = [];
        $line = 1;
        while (($cells = fgetcsv($stream, escape: '')) !== false) {
            $line++;
            if ($cells === [null] || implode('', $cells) === '') {
                continue;
            }
            if (count($rows) >= self::MAX_ROWS) {
                throw ValidationException::withMessages(['file' => 'A file can have at most '.number_format(self::MAX_ROWS).' rates.']);
            }
            $row = array_combine($header, array_pad(array_slice($cells, 0, count($header)), count($header), null));
            $row = array_map(fn ($value) => is_string($value) && trim($value) === '' ? null : (is_string($value) ? trim($value) : $value), $row);
            try {
                $rows[] = $this->validRow(array_intersect_key($row, array_flip(self::CSV_COLUMNS)), creating: true);
            } catch (ValidationException $e) {
                foreach ($e->errors() as $field => $messages) {
                    $errors["rows.{$line}.{$field}"] = $messages;
                }
            }
        }
        fclose($stream);
        if ($errors) {
            throw ValidationException::withMessages($errors);
        }
        if ($rows === []) {
            throw ValidationException::withMessages(['file' => 'The file has no rates.']);
        }

        $replace = ($request->input('mode') ?? 'replace') === 'replace';
        [$imported, $replaced] = DB::transaction(function () use ($rows, $replace) {
            $methods = array_values(array_unique(array_column($rows, 'method')));
            $replaced = $replace ? ShippingRate::whereIn('method', $methods)->delete() : 0;
            $next = [];
            foreach ($rows as $row) {
                $next[$row['method']] ??= (int) ShippingRate::where('method', $row['method'])->max('position') + ($replace ? 0 : 1);
                $row['position'] ??= $next[$row['method']]++;
                ShippingRate::create($row);
            }
            $this->audit->record('shipping_rate.imported', 'Shipping rates imported: '.count($rows).' rows'.($replace ? ", {$replaced} replaced" : '').'.',
                'shipping_rate', null, ['before' => [], 'after' => ['imported' => count($rows), 'replaced' => $replaced, 'methods' => $methods]]);

            return [count($rows), $replaced];
        });

        return response()->json(['data' => ['imported' => $imported, 'replaced' => $replaced]]);
    }

    /**
     * POST /api/admin/v1/shipping-rates/check { country?, weight_grams, subtotal } →
     * { data: [{ method, label, available, price, source, rate_id }] } for the enabled methods
     * (the rate itself: the free-shipping threshold and rules aren't applied).
     */
    public function check(Request $request): JsonResponse
    {
        $data = $request->validate([
            'country' => ['nullable', 'string', 'max:60'],
            'weight_grams' => ['required', 'integer', 'min:0', 'max:100000000'],
            'subtotal' => ['required', 'numeric', 'decimal:0,2', 'min:0', 'max:10000000'],
        ]);
        $country = filled($data['country'] ?? null) ? ShippingRates::normalizeCountry($data['country'], $this->settings->get('allowed_countries', [])) : null;
        $methods = $this->settings->shippingMethods();
        $options = $this->rates->options($methods, $country === '*' ? null : $country, (int) $data['weight_grams'], Pricing::toCents((string) $data['subtotal']));

        return response()->json(['data' => array_values(array_map(fn (array $method) => [
            'method' => $method['id'],
            'label' => $method['label'],
            'available' => isset($options[$method['id']]),
            'price' => isset($options[$method['id']]) ? Pricing::format($options[$method['id']]['price_cents']) : null,
            'source' => $options[$method['id']]['source'] ?? ($this->rates->hasRows($method['id']) ? 'table' : 'flat'),
            'rate_id' => $options[$method['id']]['rate_id'] ?? null,
        ], $methods))]);
    }

    /** A row's fields, validated and normalized (money as "0.00", the country as stored). */
    private function validRow(array $input, bool $creating): array
    {
        $money = ['numeric', 'decimal:0,2', 'min:0', 'max:10000000'];
        $data = Validator::make($input, [
            'method' => ['required', Rule::in($this->methodIds())],
            'country' => ['nullable', 'string', 'max:60'],
            'min_weight_grams' => ['nullable', 'integer', 'min:0', 'max:100000000'],
            'max_weight_grams' => ['nullable', 'integer', 'min:1', 'max:100000000'],
            'min_subtotal' => ['nullable', ...$money],
            'max_subtotal' => ['nullable', ...$money],
            'price' => ['required', ...$money],
            'position' => ['nullable', 'integer', 'min:0', 'max:100000'],
        ], [
            'method.in' => 'The method must be standard, express, or nextDay.',
            'price.required' => 'Enter a price.',
        ])->validate();

        $country = ShippingRates::normalizeCountry($data['country'] ?? null, $this->settings->get('allowed_countries', []));
        $errors = [];
        if ($country === null) {
            $errors['country'] = 'Use "*" (every country), a country from Settings → Checkout, or its 2-letter code.';
        }
        $minWeight = (int) ($data['min_weight_grams'] ?? 0);
        if (isset($data['max_weight_grams']) && $data['max_weight_grams'] <= $minWeight) {
            $errors['max_weight_grams'] = 'The maximum weight must be more than the minimum.';
        }
        $minSubtotal = Pricing::toCents((string) ($data['min_subtotal'] ?? 0));
        if (isset($data['max_subtotal']) && Pricing::toCents((string) $data['max_subtotal']) <= $minSubtotal) {
            $errors['max_subtotal'] = 'The maximum subtotal must be more than the minimum.';
        }
        if ($errors) {
            throw ValidationException::withMessages($errors);
        }

        $row = [
            'method' => $data['method'],
            'country' => $country,
            'min_weight_grams' => $minWeight,
            'max_weight_grams' => isset($data['max_weight_grams']) ? (int) $data['max_weight_grams'] : null,
            'min_subtotal' => Pricing::format($minSubtotal),
            'max_subtotal' => isset($data['max_subtotal']) ? Pricing::format(Pricing::toCents((string) $data['max_subtotal'])) : null,
            'price' => Pricing::format(Pricing::toCents((string) $data['price'])),
        ];
        if (array_key_exists('position', $data) && $data['position'] !== null) {
            $row['position'] = (int) $data['position'];
        } elseif ($creating) {
            $row['position'] = null;
        }

        return $creating && $row['position'] === null ? array_diff_key($row, ['position' => 0]) : $row;
    }

    private function methodIds(): array
    {
        return array_keys(config('buynest.store.shipping_methods'));
    }

    private function notFound(): JsonResponse
    {
        return response()->json(['message' => 'Shipping rate not found.'], 404);
    }
}

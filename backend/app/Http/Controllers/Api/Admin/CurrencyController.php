<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\CurrencyRate;
use App\Services\Audit;
use App\Support\Currency;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Phase 11: Settings → Currencies: display currencies and their rates
 * (typed in by staff; no rate service). Orders are always charged in the
 * base currency. Read settings.view, change settings.edit; audited currency.*.
 */
class CurrencyController extends Controller
{
    private const AUDITED = ['code', 'symbol', 'rate', 'decimals', 'enabled', 'position'];

    public function __construct(private Audit $audit) {}

    /** GET /api/admin/v1/currencies → { data: [row], meta: { base } } */
    public function index(): JsonResponse
    {
        return response()->json(['data' => $this->rows(), 'meta' => ['base' => self::base()]]);
    }

    /** POST /api/admin/v1/currencies → 201 { data: row } */
    public function store(Request $request): JsonResponse
    {
        $data = $this->validated($request, null);
        $rate = DB::transaction(function () use ($data) {
            $rate = CurrencyRate::create([
                'decimals' => 2,
                'enabled' => false,
                'position' => (int) CurrencyRate::max('position') + 1,
                ...$data,
            ]);
            $this->audit->record('currency.created', "Display currency {$rate->code} added.", 'currency', $rate->id,
                ['before' => [], 'after' => $rate->only(self::AUDITED)]);

            return $rate;
        });

        return response()->json(['data' => $rate->fresh()->api()], 201);
    }

    /** PATCH /api/admin/v1/currencies/{id} → { data: row } */
    public function update(Request $request, int $id): JsonResponse
    {
        $rate = CurrencyRate::find($id);
        if (! $rate) {
            return $this->notFound();
        }
        $data = $this->validated($request, $rate);
        DB::transaction(function () use ($rate, $data) {
            $before = $rate->only(self::AUDITED);
            $rate->fill($data);
            if ($rate->isDirty()) {
                $rate->save();
                $diff = Audit::diff($before, $rate->only(self::AUDITED));
                if ($diff) {
                    $this->audit->record('currency.updated', "Display currency {$rate->code} updated.", 'currency', $rate->id, $diff);
                }
            }
        });

        return response()->json(['data' => $rate->fresh()->api()]);
    }

    /** DELETE /api/admin/v1/currencies/{id} → 204 */
    public function destroy(int $id): JsonResponse
    {
        $rate = CurrencyRate::find($id);
        if (! $rate) {
            return $this->notFound();
        }
        DB::transaction(function () use ($rate) {
            $rate->delete();
            $this->audit->record('currency.deleted', "Display currency {$rate->code} removed.", 'currency', $rate->id,
                ['before' => $rate->only(self::AUDITED), 'after' => []]);
        });

        return response()->json(null, 204);
    }

    /** POST /api/admin/v1/currencies/reorder { ids: [every id, new order] } → { data: [row] } */
    public function reorder(Request $request): JsonResponse
    {
        $data = $request->validate(['ids' => ['required', 'array'], 'ids.*' => ['integer', 'distinct']]);
        $ids = array_map('intval', $data['ids']);
        $all = CurrencyRate::pluck('id')->all();
        if (count($ids) !== count($all) || array_diff($all, $ids) !== []) {
            throw ValidationException::withMessages(['ids' => 'Send every currency once, in the new order.']);
        }
        DB::transaction(function () use ($ids) {
            foreach ($ids as $position => $id) {
                DB::table('currency_rates')->where('id', $id)->update(['position' => $position + 1]); // keeps updated_at: it dates the rate
            }
            $this->audit->record('currency.reordered', 'Display currencies reordered.', 'currency', null, ['before' => [], 'after' => ['ids' => $ids]]);
        });

        return response()->json(['data' => $this->rows()]);
    }

    /** The store's base currency ("USD"). */
    public static function base(): string
    {
        return Currency::store();
    }

    private function validated(Request $request, ?CurrencyRate $rate): array
    {
        $required = $rate ? 'sometimes' : 'required';
        $request->merge(array_filter(['code' => is_string($request->input('code')) ? strtoupper(trim($request->input('code'))) : null]));
        $data = $request->validate([
            'code' => [$required, 'string', 'regex:/^[A-Z]{3}$/', Rule::notIn([self::base()]), Rule::unique('currency_rates', 'code')->ignore($rate?->id)],
            'symbol' => [$required, 'string', 'min:1', 'max:5'],
            'rate' => [$required, 'numeric', 'min:0', 'max:1000000000', 'decimal:0,8'],
            'decimals' => ['sometimes', 'integer', 'min:0', 'max:3'],
            'enabled' => ['sometimes', 'boolean'],
            'position' => ['sometimes', 'integer', 'min:0', 'max:10000'],
        ], [
            'code.regex' => 'Enter the 3-letter ISO 4217 code, for example BDT.',
            'code.not_in' => 'This is the store\'s base currency.',
            'code.unique' => 'This currency is already in the list.',
            'rate.decimal' => 'The rate can have at most 8 decimal places.',
        ]);
        if (isset($data['symbol'])) {
            $data['symbol'] = trim($data['symbol']);
        }
        $enabled = (bool) ($data['enabled'] ?? $rate?->enabled ?? false);
        $value = (float) ($data['rate'] ?? $rate?->rate ?? 0);
        if ($enabled && $value <= 0) {
            throw ValidationException::withMessages(['rate' => 'Enter a rate before turning this currency on.']);
        }

        return $data;
    }

    private function rows(): array
    {
        return CurrencyRate::orderBy('position')->orderBy('id')->get()->map(fn (CurrencyRate $rate) => $rate->api())->all();
    }

    private function notFound(): JsonResponse
    {
        return response()->json(['message' => 'Currency not found.'], 404);
    }
}

<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Http\Resources\AdminArrayResource;
use App\Models\CatalogRule;
use App\Models\Product;
use App\Services\Audit;
use App\Services\CatalogRules;
use App\Services\Pricing;
use App\Support\CategoryTree;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Carbon;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/** Catalog price rules (Marketing → Catalog price rules): list, create, edit, delete, preview. */
class CatalogRuleController extends Controller
{
    private const MONEY = 'regex:/^\d{1,7}(\.\d{1,2})?$/';

    private const AUDITED = ['name', 'description', 'is_active', 'starts_at', 'ends_at', 'customer_group_ids', 'category_ids',
        'product_ids', 'action', 'amount', 'priority', 'stop_further'];

    private const PREVIEW_LIMIT = 50;

    public function __construct(private Audit $audit) {}

    /** GET /api/admin/v1/catalog-rules?search&status&page&per_page - by priority, then id. */
    public function index(Request $request): AnonymousResourceCollection
    {
        $data = $request->validate([
            'search' => ['nullable', 'string', 'max:100'],
            'status' => ['nullable', Rule::in(CatalogRule::STATUSES)],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $rules = CatalogRule::query()
            ->when($data['search'] ?? null, function ($query, $search) {
                $like = '%'.addcslashes($search, '%_\\').'%';
                $query->where(fn ($q) => $q->where('name', 'like', $like)->orWhere('description', 'like', $like));
            })
            ->when($data['status'] ?? null, fn ($query, $status) => $query->withStatus($status))
            ->orderBy('priority')->orderBy('id')
            ->paginate($data['per_page'] ?? 20)
            ->withQueryString();

        return AdminArrayResource::collection($rules);
    }

    /** GET /api/admin/v1/catalog-rules/{id} */
    public function show(int $id): JsonResponse
    {
        $rule = CatalogRule::find($id);

        return $rule ? response()->json(['data' => $rule->toAdminArray()]) : $this->notFound();
    }

    /** POST /api/admin/v1/catalog-rules → 201 */
    public function store(Request $request): JsonResponse
    {
        $rule = new CatalogRule(['is_active' => true, 'priority' => 0, 'stop_further' => false]);
        $this->save($rule, $this->validated($request, null));

        return response()->json(['data' => $rule->fresh()->toAdminArray()], 201);
    }

    /** PATCH /api/admin/v1/catalog-rules/{id} - any of the create fields. */
    public function update(Request $request, int $id): JsonResponse
    {
        $rule = CatalogRule::find($id);
        if (! $rule) {
            return $this->notFound();
        }
        $this->save($rule, $this->validated($request, $rule));

        return response()->json(['data' => $rule->fresh()->toAdminArray()]);
    }

    /** DELETE /api/admin/v1/catalog-rules/{id} → 204 (orders keep their prices: they are snapshots). */
    public function destroy(int $id): JsonResponse
    {
        $rule = CatalogRule::find($id);
        if (! $rule) {
            return $this->notFound();
        }
        $this->audit->record('catalog_rule.deleted', "Catalog price rule \"{$rule->name}\" deleted.", 'catalog_rule', $rule->id,
            Audit::deleted(Audit::fieldsOf($rule, self::AUDITED)));
        $rule->delete();

        return response()->json(null, 204);
    }

    /**
     * GET /api/admin/v1/catalog-rules/{id}/preview - the first 50 products the
     * rule matches (not deleted, any status, by id) with their own sale price
     * and the price with this rule alone (groups and dates ignored).
     */
    public function preview(int $id): JsonResponse
    {
        $rule = CatalogRule::find($id);
        if (! $rule) {
            return $this->notFound();
        }
        $compiled = CatalogRules::compile($rule, CategoryTree::load());
        $query = Product::query()
            ->when($compiled['categories'] !== null, fn ($q) => $q->whereIn('category_id', array_keys($compiled['categories'])))
            ->when($compiled['products'] !== null, fn ($q) => $q->whereIn('id', array_keys($compiled['products'])));
        $total = (clone $query)->count();

        $items = $query->orderBy('id')->limit(self::PREVIEW_LIMIT)->get()->map(function (Product $product) use ($compiled) {
            $old = $product->salePriceCents();

            return [
                'product_id' => $product->id,
                'name' => $product->name,
                'sku' => $product->sku,
                'thumbnail_url' => $product->thumbnail_url,
                'status' => $product->status,
                'has_variants' => $product->has_variants,
                'price' => $product->price,
                'old_price' => Pricing::format($old),
                'new_price' => Pricing::format(min($old, CatalogRules::apply($product->priceCents(), [$compiled]))),
            ];
        });

        return response()->json(['data' => $items->values(), 'meta' => ['total' => $total]]);
    }

    /** Validates a create (required fields) or a partial PATCH, checking the merged result. */
    private function validated(Request $request, ?CatalogRule $rule): array
    {
        $required = $rule === null ? 'required' : 'sometimes';
        $data = $request->validate([
            'name' => [$required, 'string', 'max:120'],
            'description' => ['nullable', 'string', 'max:500'],
            'is_active' => ['sometimes', 'boolean'],
            'starts_at' => ['nullable', 'date'],
            'ends_at' => ['nullable', 'date'],
            'customer_group_ids' => ['sometimes', 'array', 'max:100'],
            'customer_group_ids.*' => ['integer', 'distinct', Rule::exists('customer_groups', 'id')],
            'category_ids' => ['sometimes', 'array', 'max:500'],
            'category_ids.*' => ['integer', 'distinct', Rule::exists('categories', 'id')],
            'product_ids' => ['sometimes', 'array', 'max:1000'],
            'product_ids.*' => ['integer', 'distinct', Rule::exists('products', 'id')->whereNull('deleted_at')],
            'action' => [$required, Rule::in(CatalogRule::ACTIONS)],
            'amount' => [$required, self::MONEY],
            'priority' => ['sometimes', 'integer', 'min:0', 'max:1000'],
            'stop_further' => ['sometimes', 'boolean'],
        ], [
            'name.required' => 'Enter a name.',
            'action.in' => 'Choose an action: percent or fixed.',
            'amount.regex' => 'Enter the amount as a number with at most 2 decimals.',
            'customer_group_ids.*.exists' => 'This customer group doesn\'t exist.',
            'category_ids.*.exists' => 'This category doesn\'t exist.',
            'product_ids.*.exists' => 'This product doesn\'t exist.',
        ]);

        // A date without a time: starts at the start of that day, ends at its end (UTC).
        foreach (['starts_at' => 'startOfDay', 'ends_at' => 'endOfDay'] as $field => $edge) {
            if (! empty($data[$field])) {
                $date = Carbon::parse($data[$field])->utc();
                $data[$field] = preg_match('/^\d{4}-\d{2}-\d{2}$/', $data[$field]) ? $date->$edge() : $date;
            }
        }
        foreach (['customer_group_ids', 'category_ids', 'product_ids'] as $field) {
            if (array_key_exists($field, $data)) {
                $data[$field] = array_values(array_map('intval', $data[$field] ?? []));
            }
        }

        $errors = [];
        $action = $data['action'] ?? $rule?->action;
        if (array_key_exists('amount', $data) || array_key_exists('action', $data)) {
            $amount = (float) ($data['amount'] ?? $rule?->amount ?? 0);
            if ($action === 'percent' && ($amount < 0.01 || $amount > 100)) {
                $errors['amount'] = 'A percent discount is between 0.01 and 100.';
            } elseif ($action === 'fixed' && $amount <= 0) {
                $errors['amount'] = 'A fixed discount must be more than $0.00.';
            }
        }
        $startsAt = array_key_exists('starts_at', $data) ? $data['starts_at'] : $rule?->starts_at;
        $endsAt = array_key_exists('ends_at', $data) ? $data['ends_at'] : $rule?->ends_at;
        if ($startsAt && $endsAt && $endsAt <= $startsAt) {
            $errors['ends_at'] = 'The end date must be after the start date.';
        }
        if ($errors) {
            throw ValidationException::withMessages($errors);
        }

        return $data;
    }

    private function save(CatalogRule $rule, array $data): void
    {
        $creating = ! $rule->exists;
        $before = $creating ? [] : Audit::fieldsOf($rule, self::AUDITED);
        $rule->fill($data)->save(); // saving clears the active rules' cache (CatalogRule::booted())

        if ($creating) {
            $this->audit->record('catalog_rule.created', "Catalog price rule \"{$rule->name}\" created.", 'catalog_rule', $rule->id,
                Audit::created(Audit::fieldsOf($rule, self::AUDITED)));
        } elseif ($changes = Audit::diff($before, Audit::fieldsOf($rule, self::AUDITED))) {
            $this->audit->record('catalog_rule.updated', "Catalog price rule \"{$rule->name}\" updated.", 'catalog_rule', $rule->id, $changes);
        }
    }

    private function notFound(): JsonResponse
    {
        return response()->json(['message' => 'Catalog price rule not found.'], 404);
    }
}

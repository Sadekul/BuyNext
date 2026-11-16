<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Http\Resources\AdminProductResource;
use App\Models\Brand;
use App\Models\Category;
use App\Models\Product;
use App\Services\Audit;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/** Products, as shop staff manage them: every status, create, edit, (soft) delete. */
class ProductController extends Controller
{
    // What the audit log records about a product (not counters like ratings).
    private const AUDITED = ['name', 'sku', 'status', 'price', 'discount_percent', 'stock_quantity', 'min_order_quantity',
        'category_id', 'brand_id', 'description', 'thumbnail_url', 'meta_title', 'meta_description'];

    public function __construct(private Audit $audit) {}

    /** GET /api/admin/v1/products?search&category&status&sort=name|price|stock|rating|newest&direction&page&per_page */
    public function index(Request $request): AnonymousResourceCollection
    {
        $data = $request->validate([...self::filterRules(), 'per_page' => ['nullable', 'integer', 'min:1', 'max:100']]);

        return AdminProductResource::collection(self::filtered($data)->with(['category', 'brand'])
            ->paginate($data['per_page'] ?? 20)
            ->withQueryString());
    }

    /** The list filters (shared with the CSV export). */
    public static function filterRules(): array
    {
        return [
            'search' => ['nullable', 'string', 'max:100'],
            'category' => ['nullable', 'string', 'max:100'],
            'status' => ['nullable', Rule::in(Product::STATUSES)],
            'sort' => ['nullable', 'in:name,price,stock,rating,newest'],
            'direction' => ['nullable', 'in:asc,desc'],
        ];
    }

    /** Products matching the list filters, sorted (category: that exact category). */
    public static function filtered(array $data): Builder
    {
        $sort = $data['sort'] ?? 'newest';
        $direction = $data['direction'] ?? (in_array($sort, ['name', 'price', 'stock'], true) ? 'asc' : 'desc');
        $column = ['name' => 'name', 'price' => 'price', 'stock' => 'stock_quantity', 'rating' => 'rating_average', 'newest' => 'created_at'][$sort];

        return Product::query()
            ->when($data['search'] ?? null, function ($query, $search) {
                $like = '%'.addcslashes($search, '%_\\').'%';
                $query->where(fn ($q) => $q->where('name', 'like', $like)->orWhere('sku', 'like', $like)
                    ->orWhereHas('brand', fn ($b) => $b->where('name', 'like', $like)));
            })
            ->when($data['category'] ?? null, fn ($query, $slug) => $query->whereHas('category', fn ($c) => $c->where('slug', $slug)))
            ->when($data['status'] ?? null, fn ($query, $status) => $query->where('status', $status))
            ->orderBy($column, $direction)
            ->orderBy('id', $direction);
    }

    /** GET /api/admin/v1/products/{id} */
    public function show(int $id): AdminProductResource|JsonResponse
    {
        $product = Product::with(self::DETAIL)->find($id);

        return $product ? (new AdminProductResource($product))->withDetail() : $this->notFound();
    }

    /** What the admin product detail loads. */
    public const DETAIL = ['category', 'brand', 'images', 'options.values', 'variants'];

    /** POST /api/admin/v1/products → 201 */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate($this->rules(null), $this->messages());

        $product = DB::transaction(function () use ($data) {
            $product = new Product([
                'name' => $data['name'],
                'slug' => Product::uniqueSlug($data['name']),
                // A placeholder until the id exists (see the generated SKU below).
                'sku' => $data['sku'] ?? 'NEW-'.Str::uuid(),
                'status' => $data['status'] ?? 'active',
                'discount_percent' => $data['discount_percent'] ?? 0,
                'min_order_quantity' => $data['min_order_quantity'] ?? 1,
            ]);
            $this->fill($product, $data);
            $product->save();

            if (empty($data['sku'])) {
                $product->forceFill(['sku' => $this->generatedSku($product)])->save();
            }
            $this->syncImages($product, $data);
            $this->audit->record('product.created', "Product {$product->sku} \"{$product->name}\" created.", 'product', $product->id,
                Audit::created(Audit::fieldsOf($product, self::AUDITED)));

            return $product;
        });

        return (new AdminProductResource($product->load(self::DETAIL)))->withDetail()
            ->response()->setStatusCode(201);
    }

    /** PATCH /api/admin/v1/products/{id} - only the fields sent change. */
    public function update(Request $request, int $id): AdminProductResource|JsonResponse
    {
        $product = Product::find($id);
        if (! $product) {
            return $this->notFound();
        }
        $data = $request->validate($this->rules($product), $this->messages());

        DB::transaction(function () use ($product, $data) {
            $before = Audit::fieldsOf($product, self::AUDITED);
            $imagesBefore = $product->images()->pluck('url')->all();
            $product->fill(collect($data)->only(['name', 'status', 'discount_percent', 'min_order_quantity'])->filter(fn ($v) => $v !== null)->all());
            if (! empty($data['sku'])) {
                $product->sku = $data['sku'];
            }
            if ($product->has_variants) {
                // Stock is set per variant; the product's is their sum.
                unset($data['stock_quantity']);
            }
            $this->fill($product, $data);
            $product->save();
            $this->syncImages($product, $data);

            $after = Audit::fieldsOf($product, self::AUDITED);
            if (array_key_exists('images', $data) && $data['images'] !== null) {
                [$before['images'], $after['images']] = [$imagesBefore, array_values($data['images'])];
            }
            if ($changes = Audit::diff($before, $after)) {
                $this->audit->record('product.updated', "Product {$product->sku} \"{$product->name}\" updated.", 'product', $product->id, $changes);
            }
        });

        return (new AdminProductResource($product->fresh(self::DETAIL)))->withDetail();
    }

    /** DELETE /api/admin/v1/products/{id} → 204. A soft delete: past orders keep their snapshots. */
    public function destroy(int $id): JsonResponse
    {
        $product = Product::find($id);
        if (! $product) {
            return $this->notFound();
        }
        DB::transaction(function () use ($product) {
            $product->delete();
            $this->audit->record('product.deleted', "Product {$product->sku} \"{$product->name}\" deleted.", 'product', $product->id,
                Audit::deleted(Audit::fieldsOf($product, ['name', 'sku', 'status', 'price', 'stock_quantity'])));
        });

        return response()->json(null, 204);
    }

    /** Create: name, category, price, and stock are required. Update: everything is optional ("sometimes"). */
    private function rules(?Product $product): array
    {
        $required = $product ? 'sometimes' : 'required';

        return [
            'name' => [$required, 'string', 'min:2', 'max:120'],
            'category' => [$required, 'string', Rule::exists('categories', 'slug')],
            // decimal:0,2 = at most 2 decimal places (19.99 yes, 19.999 no).
            'price' => [$required, 'numeric', 'decimal:0,2', 'min:0', 'max:1000000'],
            'stock_quantity' => [$required, 'integer', 'min:0', 'max:100000'],
            'sku' => ['nullable', 'string', 'max:64', 'regex:/^[A-Za-z0-9-]+$/',
                Rule::unique('products', 'sku')->ignore($product?->id), Rule::unique('product_variants', 'sku')],
            'brand' => ['nullable', 'string', 'max:80'],
            'description' => ['nullable', 'string', 'max:5000'],
            // Phase 7: SEO (empty = use the name / description).
            'meta_title' => ['nullable', 'string', 'max:190'],
            'meta_description' => ['nullable', 'string', 'max:500'],
            'discount_percent' => ['nullable', 'numeric', 'decimal:0,2', 'min:0', 'max:90'],
            'status' => ['nullable', Rule::in(Product::STATUSES)],
            'min_order_quantity' => ['nullable', 'integer', 'min:1', 'max:1000'],
            'thumbnail_url' => ['nullable', 'url', 'max:2048'],
            'images' => ['nullable', 'array', 'max:'.Product::MAX_IMAGES],
            // A web address, or one of the product's uploaded images (/media/products/...), to keep it in the list.
            'images.*' => ['required', 'string', 'max:2048', 'regex:#^(https?://\S+|/media/products/\d+/[a-f0-9]{32}\.(jpg|png|webp))$#'],
        ];
    }

    private function messages(): array
    {
        return [
            'name.required' => 'Enter a product name.',
            'name.min' => 'The name must be at least 2 characters.',
            'name.max' => 'The name can be at most 120 characters.',
            'category.required' => 'Choose a category.',
            'category.exists' => 'Choose a category from the list.',
            'price.required' => 'Enter a price.',
            'price.numeric' => 'The price must be a number.',
            'price.decimal' => 'The price can have at most 2 decimal places.',
            'price.min' => 'The price can\'t be negative.',
            'price.max' => 'The price can be at most 1,000,000.',
            'stock_quantity.required' => 'Enter the stock quantity.',
            'stock_quantity.integer' => 'The stock must be a whole number.',
            'stock_quantity.min' => 'The stock can\'t be negative.',
            'stock_quantity.max' => 'The stock can be at most 100,000.',
            'sku.unique' => 'Another product already has this SKU.',
            'sku.regex' => 'The SKU can only contain letters, numbers, and dashes.',
            'discount_percent.decimal' => 'The discount can have at most 2 decimal places.',
            'discount_percent.min' => 'The discount can\'t be negative.',
            'discount_percent.max' => 'The discount can be at most 90%.',
            'status.in' => 'The status must be draft, active, or archived.',
            'min_order_quantity.min' => 'The minimum order must be at least 1.',
            'thumbnail_url.url' => 'The thumbnail must be a web address (https://…).',
            'images.max' => 'A product can have at most '.Product::MAX_IMAGES.' images.',
            'images.*.regex' => 'Each image must be a web address (https://…).',
        ];
    }

    /** The fields shared by create and update (only those present in $data). */
    private function fill(Product $product, array $data): void
    {
        foreach (['price', 'stock_quantity', 'description'] as $field) {
            if (array_key_exists($field, $data)) {
                $product->{$field} = $data[$field];
            }
        }
        foreach (['meta_title', 'meta_description'] as $field) {
            if (array_key_exists($field, $data)) {
                $product->{$field} = filled($data[$field]) ? trim($data[$field]) : null;
            }
        }
        if (array_key_exists('category', $data)) {
            $product->category_id = Category::where('slug', $data['category'])->value('id');
        }
        if (array_key_exists('brand', $data)) {
            // A new brand name creates the brand; an empty one clears it.
            $product->brand_id = filled($data['brand']) ? Brand::firstOrCreate(['name' => trim($data['brand'])])->id : null;
        }
        if (array_key_exists('thumbnail_url', $data)) {
            $product->thumbnail_url = $data['thumbnail_url'];
        }
        if (! $product->thumbnail_url && ! empty($data['images'])) {
            $product->thumbnail_url = $data['images'][0];
        }
    }

    /**
     * `images` replaces the whole gallery when sent; left out, the gallery
     * stays as it is. An uploaded image listed again keeps its file; one left
     * out is deleted with its file. The thumbnail then follows the first image.
     */
    private function syncImages(Product $product, array $data): void
    {
        if (! array_key_exists('images', $data) || $data['images'] === null) {
            return;
        }
        $existing = $product->images()->get()->groupBy('url');
        $kept = [];
        foreach (array_values($data['images']) as $position => $url) {
            $image = $existing->get($url)?->first(fn ($image) => ! in_array($image->id, $kept, true));
            if ($image) {
                $image->update(['position' => $position]);
            } elseif (str_starts_with($url, '/media/')) {
                continue; // another product's upload (or a deleted one): not this product's to list
            } else {
                $image = $product->images()->create(['url' => $url, 'alt' => $product->name, 'position' => $position]);
            }
            $kept[] = $image->id;
        }
        foreach ($existing->flatten() as $image) {
            if (! in_array($image->id, $kept, true)) {
                $image->delete();
                DB::afterCommit(fn () => $image->deleteFile());
            }
        }
        $product->syncThumbnail();
    }

    /** Like the imported SKUs: CATEGORY-BRAND-NAME-ID, e.g. "BEA-ESS-BLU-195". */
    private function generatedSku(Product $product): string
    {
        $part = fn (?string $text) => strtoupper(substr(preg_replace('/[^A-Za-z0-9]/', '', (string) $text), 0, 3)) ?: 'GEN';

        return implode('-', [
            $part($product->category?->slug),
            $part($product->brand?->name),
            $part($product->name),
            str_pad((string) $product->id, 3, '0', STR_PAD_LEFT),
        ]);
    }

    private function notFound(): JsonResponse
    {
        return response()->json(['message' => 'Product not found.'], 404);
    }
}

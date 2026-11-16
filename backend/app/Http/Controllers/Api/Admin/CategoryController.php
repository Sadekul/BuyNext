<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\Category;
use App\Models\Product;
use App\Services\Audit;
use App\Support\CategoryTree;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Categories as a tree (Magento's Catalog → Categories): at most 3 levels,
 * no cycles, unique lower-case slugs. Reading needs products.view (the
 * product form lists them); every change needs categories.edit and is audited.
 */
class CategoryController extends Controller
{
    private const AUDITED = ['name', 'slug', 'parent_id', 'position', 'is_active', 'image_url', 'description', 'meta_title', 'meta_description'];

    public function __construct(private Audit $audit) {}

    /**
     * GET /api/admin/v1/categories → the whole tree:
     * [{ id, name, slug, parent_id, position, is_active, image_url, description, meta_title, meta_description, product_count, children }]
     * product_count: the category's own (not deleted) products, not its children's.
     */
    public function index(): JsonResponse
    {
        return response()->json(['data' => $this->tree()]);
    }

    /** POST /api/admin/v1/categories → 201 { data: the category, with children [] } */
    public function store(Request $request): JsonResponse
    {
        $data = $this->validated($request, null);

        $category = DB::transaction(function () use ($data) {
            $tree = CategoryTree::load();
            $parentId = $data['parent_id'] ?? null;
            $this->checkPlacement($tree, null, $parentId);

            $category = Category::create([
                'name' => $data['name'],
                'slug' => $data['slug'] ?? $this->uniqueSlug($data['name']),
                'parent_id' => $parentId,
                // New categories go last among their siblings, unless a position is given.
                'position' => $data['position'] ?? $this->nextPosition($parentId),
                'is_active' => $data['is_active'] ?? true,
                'image_url' => $data['image_url'] ?? null,
                'description' => $data['description'] ?? null,
                'meta_title' => $data['meta_title'] ?? null,
                'meta_description' => $data['meta_description'] ?? null,
            ]);
            $this->audit->record('category.created', "Category \"{$category->name}\" ({$category->slug}) created.", 'category', $category->id,
                Audit::created(Audit::fieldsOf($category, self::AUDITED)));

            return $category;
        });

        return response()->json(['data' => $this->find($category->id)], 201);
    }

    /** PATCH /api/admin/v1/categories/{id} - any field; moving (parent_id) is checked for cycles and depth. */
    public function update(Request $request, int $id): JsonResponse
    {
        $category = Category::find($id);
        if (! $category) {
            return $this->notFound();
        }
        $data = $this->validated($request, $category);

        DB::transaction(function () use ($category, $data) {
            $before = Audit::fieldsOf($category, self::AUDITED);
            if (array_key_exists('parent_id', $data) && $data['parent_id'] !== $category->parent_id) {
                $this->checkPlacement(CategoryTree::load(), $category->id, $data['parent_id']);
                $category->parent_id = $data['parent_id'];
                // Moved: last among the new siblings (unless a position is given too).
                $category->position = $data['position'] ?? $this->nextPosition($data['parent_id']);
            }
            $category->fill(collect($data)->except(['parent_id'])->all())->save();

            if ($changes = Audit::diff($before, Audit::fieldsOf($category, self::AUDITED))) {
                $this->audit->record('category.updated', "Category \"{$category->name}\" ({$category->slug}) updated.", 'category', $category->id, $changes);
            }
        });

        return response()->json(['data' => $this->find($category->id)]);
    }

    /** DELETE /api/admin/v1/categories/{id} → 204; 422 while it has subcategories or products. */
    public function destroy(int $id): JsonResponse
    {
        $category = Category::find($id);
        if (! $category) {
            return $this->notFound();
        }

        DB::transaction(function () use ($category) {
            $children = Category::where('parent_id', $category->id)->count();
            $products = Product::where('category_id', $category->id)->count();
            $deleted = Product::onlyTrashed()->where('category_id', $category->id)->count();
            $problem = match (true) {
                $children > 0 => "This category has {$children} ".Str::plural('subcategory', $children).'. Move or delete them first.',
                $products > 0 => "This category has {$products} ".Str::plural('product', $products).'. Move them to another category first.',
                // Deleted products keep their category for past orders, so the row must stay.
                $deleted > 0 => "This category still has {$deleted} deleted ".Str::plural('product', $deleted).' (kept for past orders), so it can\'t be deleted. Deactivate it instead.',
                default => null,
            };
            if ($problem) {
                throw ValidationException::withMessages(['category' => $problem]);
            }

            $category->delete();
            $this->audit->record('category.deleted', "Category \"{$category->name}\" ({$category->slug}) deleted.", 'category', $category->id,
                Audit::deleted(Audit::fieldsOf($category, self::AUDITED)));
        });

        return response()->json(null, 204);
    }

    /**
     * POST /api/admin/v1/categories/reorder { parent_id (null = top level), ids: [...] }
     * Sets position 0, 1, 2... in that order. Every id must be a child of parent_id.
     * Answers the whole tree.
     */
    public function reorder(Request $request): JsonResponse
    {
        $data = $request->validate([
            'parent_id' => ['present', 'nullable', 'integer'],
            'ids' => ['required', 'array', 'min:1', 'max:500'],
            'ids.*' => ['integer', 'distinct'],
        ], ['ids.*.distinct' => 'Each category can be listed only once.']);

        DB::transaction(function () use ($data) {
            $parentId = $data['parent_id'] === null ? null : (int) $data['parent_id'];
            $ids = array_map('intval', $data['ids']);
            $siblings = Category::whereIn('id', $ids)->lockForUpdate()->get()->keyBy('id');
            foreach ($ids as $index => $id) {
                $sibling = $siblings->get($id);
                if (! $sibling || $sibling->parent_id !== $parentId) {
                    throw ValidationException::withMessages(["ids.{$index}" => 'All the categories must have the same parent.']);
                }
            }
            $before = $siblings->map->position->all();
            foreach ($ids as $position => $id) {
                $siblings[$id]->update(['position' => $position]);
            }
            $this->audit->record('category.reordered', 'Categories reordered'.($parentId ? ' under "'.Category::find($parentId)?->name.'".' : ' (top level).'),
                'category', $parentId, ['before' => ['positions' => $before], 'after' => ['positions' => array_flip($ids)]]);
        });

        return response()->json(['data' => $this->tree()]);
    }

    private function tree(): array
    {
        $counts = Product::selectRaw('category_id, COUNT(*) AS n')->groupBy('category_id')->pluck('n', 'category_id');

        return CategoryTree::load()->nested(fn (Category $category) => $this->item($category, (int) ($counts[$category->id] ?? 0)));
    }

    /** One category with its subtree, as in the tree. */
    private function find(int $id): array
    {
        $find = function (array $nodes) use (&$find, $id) {
            foreach ($nodes as $node) {
                if ($node['id'] === $id) {
                    return $node;
                }
                if ($found = $find($node['children'])) {
                    return $found;
                }
            }

            return null;
        };

        return $find($this->tree());
    }

    private function item(Category $category, int $productCount): array
    {
        return [
            'id' => $category->id,
            'name' => $category->name,
            'slug' => $category->slug,
            'parent_id' => $category->parent_id,
            'position' => $category->position,
            'is_active' => $category->is_active,
            'image_url' => $category->image_url,
            'description' => $category->description,
            'meta_title' => $category->meta_title,
            'meta_description' => $category->meta_description,
            'product_count' => $productCount,
        ];
    }

    private function validated(Request $request, ?Category $category): array
    {
        $required = $category ? 'sometimes' : 'required';

        $data = $request->validate([
            'name' => [$required, 'string', 'min:2', 'max:120'],
            'slug' => [$category ? 'sometimes' : 'nullable', 'string', 'max:100', 'regex:/^[a-z0-9]+(?:-[a-z0-9]+)*$/',
                Rule::unique('categories', 'slug')->ignore($category?->id)],
            'parent_id' => ['sometimes', 'nullable', 'integer', Rule::exists('categories', 'id')],
            'position' => ['sometimes', 'integer', 'min:0', 'max:100000'],
            'is_active' => ['sometimes', 'boolean'],
            'image_url' => ['sometimes', 'nullable', 'string', 'max:2048', 'regex:#^(https://|/media/)#'],
            'description' => ['sometimes', 'nullable', 'string', 'max:5000'],
            'meta_title' => ['sometimes', 'nullable', 'string', 'max:190'],
            'meta_description' => ['sometimes', 'nullable', 'string', 'max:500'],
        ], [
            'name.required' => 'Enter a category name.',
            'slug.regex' => 'The URL key can only contain lower-case letters, numbers, and dashes (for example "phone-cases").',
            'slug.unique' => 'Another category already uses this URL key.',
            'parent_id.exists' => 'Choose a parent category from the list.',
            'image_url.regex' => 'The image must be an https:// address.',
        ]);
        foreach (['description', 'meta_title', 'meta_description', 'image_url'] as $field) {
            if (array_key_exists($field, $data) && is_string($data[$field])) {
                $data[$field] = trim($data[$field]) === '' ? null : trim($data[$field]);
            }
        }
        if (isset($data['parent_id'])) {
            $data['parent_id'] = (int) $data['parent_id'];
        }

        return $data;
    }

    /** 422 when $categoryId (null: a new one) can't go under $parentId: a cycle, or deeper than 3 levels. */
    private function checkPlacement(CategoryTree $tree, ?int $categoryId, ?int $parentId): void
    {
        if ($parentId === null) {
            return;
        }
        if ($categoryId !== null && in_array($parentId, $tree->descendantIds($categoryId), true)) {
            throw ValidationException::withMessages(['parent_id' => 'A category can\'t be moved under itself or one of its subcategories.']);
        }
        $height = $categoryId === null ? 1 : $tree->height($categoryId);
        if ($tree->depth($parentId) + $height > CategoryTree::MAX_DEPTH) {
            throw ValidationException::withMessages(['parent_id' => 'Categories can be at most '.CategoryTree::MAX_DEPTH.' levels deep.']);
        }
    }

    private function nextPosition(?int $parentId): int
    {
        $max = Category::where('parent_id', $parentId)->max('position');

        return $max === null ? 0 : $max + 1;
    }

    private function uniqueSlug(string $name): string
    {
        $base = Str::slug($name) ?: 'category';
        $slug = $base;
        for ($n = 2; Category::where('slug', $slug)->exists(); $n++) {
            $slug = "{$base}-{$n}";
        }

        return $slug;
    }

    private function notFound(): JsonResponse
    {
        return response()->json(['message' => 'Category not found.'], 404);
    }
}

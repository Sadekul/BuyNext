<?php

namespace App\Support;

use App\Models\Category;
use Illuminate\Support\Collection;

/**
 * The category tree, loaded in one query (a shop has dozens of categories,
 * not thousands). Answers the tree questions the catalog needs: which
 * categories are visible, a category's descendants, depths for the 3-level
 * limit, and cycles when a category moves.
 */
final class CategoryTree
{
    public const MAX_DEPTH = 3;

    /** @var Collection<int, Category> id => category */
    private Collection $byId;

    /** @var array<int|string, list<int>> parent id ('' for top level) => child ids, in display order */
    private array $children = [];

    public function __construct(?Collection $categories = null)
    {
        $categories ??= Category::with('translations')->orderBy('position')->orderBy('name')->orderBy('id')->get();
        $this->byId = $categories->keyBy('id');
        foreach ($categories as $category) {
            $this->children[$category->parent_id ?? ''][] = $category->id;
        }
    }

    public static function load(): self
    {
        return new self;
    }

    public function get(int $id): ?Category
    {
        return $this->byId->get($id);
    }

    /** @return list<int> the children of $parentId (null = top level), in display order */
    public function childIds(?int $parentId): array
    {
        return $this->children[$parentId ?? ''] ?? [];
    }

    /** $id and every category below it. */
    public function descendantIds(int $id): array
    {
        $ids = [$id];
        foreach ($this->childIds($id) as $child) {
            array_push($ids, ...$this->descendantIds($child));
        }

        return $ids;
    }

    /** 1 for a top-level category, 2 for its child, 3 for a grandchild. */
    public function depth(int $id): int
    {
        $depth = 0;
        $seen = [];
        for ($current = $this->get($id); $current && ! isset($seen[$current->id]); $current = $current->parent_id ? $this->get($current->parent_id) : null) {
            $seen[$current->id] = true;
            $depth++;
        }

        return $depth;
    }

    /** How many levels the subtree under $id has, $id included (1 = no children). */
    public function height(int $id): int
    {
        $below = 0;
        foreach ($this->childIds($id) as $child) {
            $below = max($below, $this->height($child));
        }

        return 1 + $below;
    }

    /** Ids of the categories shoppers see: active, with every ancestor active. */
    public function visibleIds(): array
    {
        $visible = [];
        $walk = function (?int $parentId) use (&$walk, &$visible) {
            foreach ($this->childIds($parentId) as $id) {
                if ($this->get($id)->is_active) {
                    $visible[] = $id;
                    $walk($id);
                }
            }
        };
        $walk(null);

        return $visible;
    }

    public function isVisible(?int $id): bool
    {
        if ($id === null) {
            return false;
        }
        for ($current = $this->get($id), $steps = 0; $current; $current = $current->parent_id ? $this->get($current->parent_id) : null) {
            if (! $current->is_active || ++$steps > self::MAX_DEPTH + 5) {
                return false;
            }
        }

        return $this->get($id) !== null;
    }

    /**
     * Nested arrays: $map(category) plus `children`, from $parentId down.
     * $include(category) false leaves that category (and everything below it) out.
     */
    public function nested(callable $map, ?callable $include = null, ?int $parentId = null): array
    {
        $nodes = [];
        foreach ($this->childIds($parentId) as $id) {
            $category = $this->get($id);
            if ($include && ! $include($category)) {
                continue;
            }
            $nodes[] = [...$map($category), 'children' => $this->nested($map, $include, $id)];
        }

        return $nodes;
    }
}

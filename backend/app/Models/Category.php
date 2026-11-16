<?php

namespace App\Models;

use App\Services\CatalogRules;
use Database\Factories\CategoryFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A product category ("beauty", "smartphones"). The storefront uses the slug
 * in URLs. Since phase 5 categories form a tree (parent_id, at most 3 levels;
 * see App\Support\CategoryTree). A category is visible in the store when it
 * and all its ancestors are active.
 */
#[Fillable(['slug', 'name', 'image_url', 'position', 'parent_id', 'description', 'is_active', 'meta_title', 'meta_description'])]
class Category extends Model
{
    /** Phase 7: catalog price rules include a category's descendants, so a tree change clears their cache. */
    protected static function booted(): void
    {
        static::saved(fn () => app(CatalogRules::class)->flush());
        static::deleted(fn () => app(CatalogRules::class)->flush());
    }

    /** @use HasFactory<CategoryFactory> */
    use HasFactory;

    protected $attributes = ['is_active' => true];

    protected function casts(): array
    {
        return ['is_active' => 'boolean', 'position' => 'integer', 'parent_id' => 'integer'];
    }

    public function products(): HasMany
    {
        return $this->hasMany(Product::class);
    }

    public function parent(): BelongsTo
    {
        return $this->belongsTo(self::class, 'parent_id');
    }

    public function children(): HasMany
    {
        return $this->hasMany(self::class, 'parent_id')->orderBy('position')->orderBy('name');
    }
}

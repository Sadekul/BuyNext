<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Phase 11: a Magento product link: a related product, an up-sell, or a cross-sell of product_id. */
#[Fillable(['product_id', 'linked_product_id', 'type', 'position'])]
class ProductLink extends Model
{
    public $timestamps = false;

    public const TYPES = ['related', 'upsell', 'crosssell'];

    /** The most products one list may have. */
    public const MAX_PER_TYPE = 20;

    protected function casts(): array
    {
        return ['position' => 'integer'];
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }

    public function linked(): BelongsTo
    {
        return $this->belongsTo(Product::class, 'linked_product_id');
    }
}

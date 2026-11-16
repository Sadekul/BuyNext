<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** One line of an order: a snapshot of the product and its price at checkout. */
#[Fillable([
    'order_id', 'product_id', 'variant_id', 'sku', 'name', 'variant_label', 'thumbnail_url', 'unit_price', 'discount_percent',
    'sale_price', 'quantity', 'line_total',
])]
class OrderItem extends Model
{
    public $timestamps = false;

    protected function casts(): array
    {
        return [
            'unit_price' => 'decimal:2',
            'discount_percent' => 'decimal:2',
            'sale_price' => 'decimal:2',
            'line_total' => 'decimal:2',
            'quantity' => 'integer',
        ];
    }

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    /** withTrashed: a deleted product still restocks when its order is cancelled. */
    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class)->withTrashed();
    }

    public function variant(): BelongsTo
    {
        return $this->belongsTo(ProductVariant::class);
    }

    /** "Blue Shirt (Size: M / Color: Red)" for emails and documents. */
    public function displayName(): string
    {
        return $this->variant_label ? "{$this->name} ({$this->variant_label})" : $this->name;
    }
}

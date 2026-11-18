<?php

namespace App\Models;

use App\Services\Pricing;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;

/**
 * Phase 10 (part B): one shipping table rate. A method with rows takes its
 * price from the first row that matches the cart (see App\Services\ShippingRates).
 * Ranges include the minimum and exclude the maximum (null = no limit).
 */
#[Fillable(['method', 'country', 'min_weight_grams', 'max_weight_grams', 'min_subtotal', 'max_subtotal', 'price', 'position'])]
class ShippingRate extends Model
{
    protected function casts(): array
    {
        return [
            'min_weight_grams' => 'integer',
            'max_weight_grams' => 'integer',
            'min_subtotal' => 'decimal:2',
            'max_subtotal' => 'decimal:2',
            'price' => 'decimal:2',
            'position' => 'integer',
        ];
    }

    public function matches(?string $country, int $weightGrams, int $subtotalCents): bool
    {
        return ($this->country === '*' || ($country !== null && mb_strtolower($this->country) === mb_strtolower(trim($country))))
            && $weightGrams >= $this->min_weight_grams
            && ($this->max_weight_grams === null || $weightGrams < $this->max_weight_grams)
            && $subtotalCents >= Pricing::toCents($this->min_subtotal)
            && ($this->max_subtotal === null || $subtotalCents < Pricing::toCents($this->max_subtotal));
    }

    /** The admin's row: { id, method, country, min_weight_grams, max_weight_grams, min_subtotal, max_subtotal, price, position }. */
    public function toApi(): array
    {
        return [
            'id' => $this->id,
            'method' => $this->method,
            'country' => $this->country,
            'min_weight_grams' => $this->min_weight_grams,
            'max_weight_grams' => $this->max_weight_grams,
            'min_subtotal' => $this->min_subtotal,
            'max_subtotal' => $this->max_subtotal,
            'price' => $this->price,
            'position' => $this->position,
        ];
    }
}

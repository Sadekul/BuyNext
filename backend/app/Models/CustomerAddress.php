<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** One entry of a customer's address book (at most 20; one default shipping and one default billing). */
#[Fillable([
    'customer_id', 'first_name', 'last_name', 'company', 'phone', 'line1', 'line2', 'city', 'state', 'postal_code', 'country',
    'is_default_shipping', 'is_default_billing',
])]
class CustomerAddress extends Model
{
    public const MAX_PER_CUSTOMER = 20;

    /** The fields an order's address has (orders.shipping_address), in its order. */
    public const ORDER_FIELDS = ['first_name', 'last_name', 'line1', 'line2', 'city', 'state', 'postal_code', 'country'];

    protected function casts(): array
    {
        return ['is_default_shipping' => 'boolean', 'is_default_billing' => 'boolean'];
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }

    /** The address as an order stores it. */
    public function toOrderAddress(): array
    {
        return collect(self::ORDER_FIELDS)->mapWithKeys(fn ($field) => [$field => $this->{$field}])->all();
    }

    /** The API shape (store and admin). */
    public function toApiArray(): array
    {
        return [
            'id' => $this->id,
            'first_name' => $this->first_name,
            'last_name' => $this->last_name,
            'company' => $this->company,
            'phone' => $this->phone,
            'line1' => $this->line1,
            'line2' => $this->line2,
            'city' => $this->city,
            'state' => $this->state,
            'postal_code' => $this->postal_code,
            'country' => $this->country,
            'is_default_shipping' => $this->is_default_shipping,
            'is_default_billing' => $this->is_default_billing,
            'created_at' => $this->created_at?->toIso8601ZuluString(),
            'updated_at' => $this->updated_at?->toIso8601ZuluString(),
        ];
    }
}

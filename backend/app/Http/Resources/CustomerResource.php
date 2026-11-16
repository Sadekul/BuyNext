<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** What a customer may see about their own account (allow-list: never the password hash). */
class CustomerResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'first_name' => $this->first_name,
            'last_name' => $this->last_name,
            'email' => $this->email,
            'phone' => $this->phone,
            'email_verified' => $this->email_verified_at !== null,
            // Phase 6: the price group, so the storefront can say "Wholesale price: 10% off at checkout".
            'group' => $this->priceGroup()?->summary(),
            'created_at' => $this->created_at?->toIso8601ZuluString(),
        ];
    }
}

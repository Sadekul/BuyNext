<?php

namespace App\Http\Resources;

use App\Services\Newsletter;
use App\Services\WelcomeCoupons;
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
            // Phase 9 (part A): a new address waiting for its code (POST /me/email/confirm).
            'pending_email' => $this->pending_email,
            // Phase 6: the price group, so the storefront can say "Wholesale price: 10% off at checkout".
            'group' => $this->priceGroup()?->summary(),
            // Phase 7: the Account → newsletter toggle.
            'newsletter' => app(Newsletter::class)->isSubscribed($this->resource),
            'locale' => $this->locale, // phase 13: "en" | "bn" | null (= the store default)
            'reward_points' => (int) ($this->reward_points ?? 0), // phase 11: the reward point balance
            // Phase 19: the account's welcome code { code, label, min_subtotal, first_order_only, expires_at, status } or null.
            'welcome_coupon' => app(WelcomeCoupons::class)->forEmail((string) $this->email),
            'created_at' => $this->created_at?->toIso8601ZuluString(),
        ];
    }
}

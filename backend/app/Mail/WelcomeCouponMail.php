<?php

namespace App\Mail;

use App\Mail\Concerns\RendersEmailTemplate;
use App\Models\Coupon;
use App\Services\WelcomeCoupons;
use App\Support\EmailBlocks;
use App\Support\Locale;
use Illuminate\Mail\Mailable;
use Illuminate\Support\Carbon;

/**
 * Phase 19: "Your welcome code" (template welcome_coupon), sent once per
 * email address by WelcomeCoupons::grant(), in the customer's (or the
 * subscriber's) language. The wording comes from the coupon itself, so a
 * later change of the settings never changes what an email promised.
 */
class WelcomeCouponMail extends Mailable
{
    use RendersEmailTemplate;

    public function __construct(public Coupon $coupon, public ?string $customerName, string $locale)
    {
        $this->locale(Locale::normalize($locale) ?? Locale::storeDefault());
    }

    protected function templateKey(): string
    {
        return 'welcome_coupon';
    }

    protected function templateValues(): array
    {
        $shop = config('buynest.storefront_url');

        return self::values($this->coupon->code, $this->coupon->type, (string) $this->coupon->value,
            $this->coupon->min_subtotal === null ? null : (string) $this->coupon->min_subtotal,
            (bool) $this->coupon->first_order_only, $this->coupon->ends_at, $this->customerName, $shop);
    }

    /** The template values (also the admin preview's sample), in the current language. */
    public static function values(string $code, string $type, string $value, ?string $minSubtotal, bool $firstOrderOnly,
        mixed $endsAt, ?string $customerName, string $shopUrl): array
    {
        $offer = WelcomeCoupons::label($type, $value);

        return [
            'customer_name' => filled($customerName) ? $customerName : __('there'),
            'code' => $code,
            'offer' => $offer,
            'offer_line' => $firstOrderOnly ? __(':offer your first order', ['offer' => $offer]) : __(':offer your next order', ['offer' => $offer]),
            'min_spend_line' => $minSubtotal === null ? '' : __('Valid on orders of :amount or more.', ['amount' => WelcomeCoupons::amount($minSubtotal)]),
            'expires_on' => Locale::date($endsAt ? Carbon::parse($endsAt)->tz(config('app.timezone')) : null),
            'shop_url' => $shopUrl,
            'button' => EmailBlocks::button($shopUrl, __('Start shopping')),
        ];
    }
}

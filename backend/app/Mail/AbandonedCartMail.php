<?php

namespace App\Mail;

use App\Mail\Concerns\RendersEmailTemplate;
use App\Models\Customer;
use App\Services\Pricing;
use App\Support\EmailBlocks;
use App\Support\Locale;
use Illuminate\Mail\Mailable;

/** Phase 7: "You left something in your cart" (template abandoned_cart), sent from Reports → Abandoned carts. */
class AbandonedCartMail extends Mailable
{
    use RendersEmailTemplate;

    /** $lines: CustomerCarts::lines() as arrays (name, variant_label, quantity, sale_cents). */
    public function __construct(public Customer $customer, public array $lines, public string $subtotal)
    {
        $this->locale(Locale::forCustomer($customer) ?? Locale::storeDefault()); // phase 13: staff send it, so not the request's language
    }

    protected function templateKey(): string
    {
        return 'abandoned_cart';
    }

    protected function templateValues(): array
    {
        $cartUrl = config('buynest.storefront_url').'/cart';

        return [
            'customer_first_name' => $this->customer->first_name,
            'cart_subtotal' => $this->subtotal,
            'cart_url' => $cartUrl,
            'items_table' => EmailBlocks::itemsTable(
                array_map(fn (array $line) => [
                    $line['name'].($line['variant_label'] ? " ({$line['variant_label']})" : '').' × '.$this->number($line['quantity']),
                    $this->money(Pricing::format($line['sale_cents'] * $line['quantity'])),
                ], $this->lines),
                [[__('Subtotal'), $this->money($this->subtotal), true]],
            ),
            'button' => EmailBlocks::button($cartUrl, __('Back to your cart')),
        ];
    }
}

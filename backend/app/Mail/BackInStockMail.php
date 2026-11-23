<?php

namespace App\Mail;

use App\Mail\Concerns\RendersEmailTemplate;
use App\Models\StockAlert;
use App\Support\EmailBlocks;
use App\Support\Locale;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Headers;

/**
 * Phase 9 (part B): "It's back in stock" (template back_in_stock), sent once
 * per alert by SendStockAlertBatch, with a one-click "stop these alerts"
 * link in the footer and a List-Unsubscribe header.
 */
class BackInStockMail extends Mailable
{
    use RendersEmailTemplate;

    public function __construct(public StockAlert $alert, public string $unsubscribeUrl)
    {
        // Phase 13: the customer's language for an account's alert; a guest's alert (no language kept) uses the store default.
        $this->locale(Locale::forCustomer($alert->customer) ?? Locale::storeDefault());
    }

    protected function templateKey(): string
    {
        return 'back_in_stock';
    }

    protected function templateValues(): array
    {
        $product = $this->alert->product;
        $url = config('buynest.storefront_url').'/products/'.$this->alert->product_id;
        $label = $this->alert->variant && $product ? $this->alert->variant->label($product->optionValueMap()) : '';

        return [
            'product_name' => (string) $product?->name,
            'variant_label' => $label !== '' ? "({$label})" : '',
            'product_url' => $url,
            'unsubscribe_url' => $this->unsubscribeUrl,
            'button' => EmailBlocks::button($url, __('Shop now')),
        ];
    }

    protected function templateLayout(): array
    {
        $why = __('You get this email because you asked us to tell you when this item was back.');

        return [
            'footer_html' => e($why).' <a href="'.e($this->unsubscribeUrl).'" style="color:#78716c">'.e(__('Stop these alerts')).'</a>',
            'footer_text' => $why.' '.__('Stop these alerts').": {$this->unsubscribeUrl}",
        ];
    }

    public function headers(): Headers
    {
        return new Headers(text: ['List-Unsubscribe' => "<{$this->unsubscribeUrl}>"]);
    }
}

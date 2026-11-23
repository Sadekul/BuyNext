<?php

namespace App\Mail\Concerns;

use App\Services\EmailTemplates;
use App\Services\Settings;
use App\Support\Currency;
use App\Support\Locale;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

/**
 * Phase 7: a mailable whose subject and body come from an email template
 * (App\Services\EmailTemplates). The mailable only says which template and
 * which values; staff can change the wording in the admin.
 *
 * Phase 13: each mailable sets its language in the constructor
 * ($this->locale(...)); Laravel renders it inside that locale, so the
 * template version, __() texts, money and numbers follow it. Without one, the
 * email is in the language of the request that sends it.
 */
trait RendersEmailTemplate
{
    /** The rendered email, made once per mailable (subject, html, text). */
    private ?array $renderedTemplate = null;

    abstract protected function templateKey(): string;

    /** name => value for the template's variables (blocks as prebuilt HTML from EmailBlocks). */
    abstract protected function templateValues(): array;

    /** Extra bits for the frame (preheader, footer); none by default. */
    protected function templateLayout(): array
    {
        return [];
    }

    public function envelope(): Envelope
    {
        return new Envelope(subject: $this->renderedTemplate()['subject']);
    }

    public function content(): Content
    {
        $rendered = $this->renderedTemplate();

        return new Content(view: 'emails.template', text: 'emails.template-text',
            with: ['emailHtml' => $rendered['html'], 'emailText' => $rendered['text']]);
    }

    protected function renderedTemplate(): array
    {
        return $this->renderedTemplate ??= app(EmailTemplates::class)->render($this->templateKey(), $this->templateValues(),
            layout: $this->templateLayout(), currency: $this->templateCurrency());
    }

    protected static function storeName(): string
    {
        return (string) app(Settings::class)->get('store_name');
    }

    /** Phase 12: the currency the email's amounts are in (the order's); null = the store currency. */
    protected function templateCurrency(): ?string
    {
        return null;
    }

    /** An amount in the email's currency ("$59.97", "৳1,250.00"; phase 13: "৳১,২৫০.০০" in Bangla with Bangla digits on). */
    protected function money(string|int|float|null $amount): string
    {
        return Currency::format($amount, $this->templateCurrency(), Locale::current());
    }

    /** Phase 13: a count in the email's language ("1,250" / "১,২৫০"). */
    protected function number(int|float $number): string
    {
        return Locale::number($number);
    }
}

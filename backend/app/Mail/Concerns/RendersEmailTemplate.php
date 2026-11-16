<?php

namespace App\Mail\Concerns;

use App\Services\EmailTemplates;
use App\Services\Settings;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

/**
 * Phase 7: a mailable whose subject and body come from an email template
 * (App\Services\EmailTemplates). The mailable only says which template and
 * which values; staff can change the wording in the admin.
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
        return $this->renderedTemplate ??= app(EmailTemplates::class)->render($this->templateKey(), $this->templateValues(), layout: $this->templateLayout());
    }

    protected static function storeName(): string
    {
        return (string) app(Settings::class)->get('store_name');
    }

    protected static function money(string|int|float|null $amount): string
    {
        return '$'.$amount;
    }
}

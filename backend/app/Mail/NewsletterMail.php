<?php

namespace App\Mail;

use App\Models\NewsletterCampaign;
use App\Services\EmailTemplates;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Mail\Mailables\Headers;

/**
 * Phase 7: one newsletter campaign email. The campaign body (sanitized HTML)
 * goes in the store frame with the preheader as hidden preview text and an
 * unsubscribe link in the footer, plus a List-Unsubscribe header so mail
 * apps can show their own "Unsubscribe" button.
 * $unsubscribeUrl is null for a test send to an admin.
 */
class NewsletterMail extends Mailable
{
    private ?array $rendered = null;

    public function __construct(public NewsletterCampaign $campaign, public ?string $unsubscribeUrl, public bool $test = false) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: $this->rendered()['subject']);
    }

    public function headers(): Headers
    {
        return new Headers(text: $this->unsubscribeUrl ? ['List-Unsubscribe' => "<{$this->unsubscribeUrl}>"] : []);
    }

    public function content(): Content
    {
        return new Content(view: 'emails.template', text: 'emails.template-text',
            with: ['emailHtml' => $this->rendered()['html'], 'emailText' => $this->rendered()['text']]);
    }

    private function rendered(): array
    {
        $url = $this->unsubscribeUrl ?? config('buynest.storefront_url').'/newsletter/unsubscribe';
        $why = 'You get this email because you subscribed to our newsletter.';

        return $this->rendered ??= app(EmailTemplates::class)->wrap(
            ($this->test ? '[Test] ' : '').$this->campaign->subject,
            $this->campaign->body,
            [
                'preheader' => $this->campaign->preheader,
                'footer_html' => e($why).' <a href="'.e($url).'" style="color:#78716c">Unsubscribe</a>',
                'footer_text' => "{$why} Unsubscribe: {$url}",
            ],
        );
    }
}

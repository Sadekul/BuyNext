<?php

namespace App\Mail;

use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

/** Phase 7: an email that is already rendered (subject, html, text), e.g. an email template's test send. */
class RenderedMail extends Mailable
{
    public function __construct(public string $mailSubject, public string $emailHtml, public string $emailText) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: $this->mailSubject);
    }

    public function content(): Content
    {
        return new Content(view: 'emails.template', text: 'emails.template-text');
    }
}

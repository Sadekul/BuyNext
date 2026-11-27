<?php

namespace App\Services\Sms;

/**
 * Phase 20: one SMS provider (the log driver, SSL Wireless, BulkSMSBD). Each
 * provider's wire format lives in its one driver class, so a correction is a
 * one-file change; Sms holds the rules that are the same for every provider.
 */
interface SmsDriver
{
    /** "ssl_wireless", also what sms_messages.provider and the sms_provider setting keep. */
    public function key(): string;

    public function label(): string;

    /** Are its credentials in backend/.env? */
    public function configured(): bool;

    /**
     * Sends one text. $to: +8801XXXXXXXXX. $reference: our unique id for this
     * attempt (≤ 20 characters), for providers that take one.
     * A refusal is an SmsResult with ok false (the provider's reason); a
     * provider that can't be reached throws.
     *
     * @throws SmsException
     */
    public function send(string $to, string $body, string $reference): SmsResult;
}

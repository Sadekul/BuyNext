<?php

namespace App\Services\Sms;

/**
 * Phase 20: the default "provider": the text is only saved (sms_messages,
 * readable in the dev SMS inbox at /dev/sms and in the admin's SMS log),
 * nothing leaves the server. Always set up; development, tests and the
 * browser suite use it.
 */
class LogDriver implements SmsDriver
{
    public function key(): string
    {
        return 'log';
    }

    public function label(): string
    {
        return 'Test mode (log only)';
    }

    public function configured(): bool
    {
        return true;
    }

    /** "log-{id}": the reference starts with the sms_messages id ("12" or "12-2" for a retry). */
    public function send(string $to, string $body, string $reference): SmsResult
    {
        return SmsResult::sent('log-'.strtok($reference, '-'));
    }
}

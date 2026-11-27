<?php

namespace App\Services\Sms;

/** Phase 20: what a provider answered to one text. $error: its reason (safe to show staff), when not ok. */
final readonly class SmsResult
{
    public function __construct(
        public bool $ok,
        public ?string $messageId = null,
        public ?string $error = null,
    ) {}

    public static function sent(?string $messageId): self
    {
        return new self(true, $messageId);
    }

    public static function failed(string $error): self
    {
        return new self(false, null, mb_substr($error, 0, 300));
    }
}

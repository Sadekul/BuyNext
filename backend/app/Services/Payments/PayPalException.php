<?php

namespace App\Services\Payments;

use RuntimeException;

/**
 * Phase 10 (part B): PayPal couldn't be reached, or refused a request. The
 * message is safe to show to staff or shoppers (never the client secret).
 * $issue: PayPal's error code when it gave one (e.g. ORDER_ALREADY_CAPTURED,
 * INSTRUMENT_DECLINED); $unreachable: no answer at all (a retry may work).
 */
class PayPalException extends RuntimeException
{
    public function __construct(string $message, public readonly ?string $issue = null, public readonly bool $unreachable = false)
    {
        parent::__construct($message);
    }
}
